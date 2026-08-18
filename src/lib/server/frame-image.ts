import type { color } from '$lib/dither';
import { frameFormat } from '$lib/device-contract';
import sharp from 'sharp';

const palette = [
	[0, 0, 0],
	[255, 255, 255],
	[0, 255, 0],
	[0, 0, 255],
	[255, 0, 0],
	[255, 255, 0],
	[255, 128, 0],
	[100, 81, 116]
] as color[];

export type EncodedFrameImage = {
	indexedPixels: Uint8ClampedArray;
	artifact: Buffer;
};

export async function framePixelsToPng(indexedPixels: Uint8Array): Promise<Buffer> {
	const expectedLength = frameFormat.width * frameFormat.height;
	if (indexedPixels.length !== expectedLength) {
		throw new Error(`Expected ${expectedLength} indexed pixels, received ${indexedPixels.length}`);
	}

	const rgb = Buffer.alloc(expectedLength * 3);
	for (let index = 0; index < indexedPixels.length; index += 1) {
		const paletteColor = palette[indexedPixels[index]];
		if (!paletteColor) {
			throw new Error(`Invalid frame palette index: ${indexedPixels[index]}`);
		}
		const offset = index * 3;
		rgb[offset] = paletteColor[0];
		rgb[offset + 1] = paletteColor[1];
		rgb[offset + 2] = paletteColor[2];
	}

	return sharp(rgb, {
		raw: {
			width: frameFormat.width,
			height: frameFormat.height,
			channels: 3
		}
	})
		.png()
		.toBuffer();
}

export async function encodeImageAsFrame(input: Uint8Array | Buffer): Promise<EncodedFrameImage> {
	const inputRaw = await sharp(input)
		.ensureAlpha()
		.resize(frameFormat.width, frameFormat.height, {
			// Quantization assumes an exact 800x480 row stride. `outside` can produce a
			// larger raster for content whose intrinsic bounds escape its canvas.
			fit: sharp.fit.cover,
			position: sharp.position.centre
		})
		.raw()
		.toBuffer();

	const indexedPixels = quantizeToFramePalette(inputRaw, frameFormat.width, frameFormat.height);
	return {
		indexedPixels,
		artifact: encodeFrameArtifact(indexedPixels, frameFormat.width, frameFormat.height)
	};
}

function quantizeToFramePalette(uint8data: Uint8Array, width: number, height: number) {
	const output = new Uint8ClampedArray(width * height);

	for (let offset = 0; offset < output.length; offset += 1) {
		const inputOffset = offset * 4;
		const original: color = [
			uint8data[inputOffset],
			uint8data[inputOffset + 1],
			uint8data[inputOffset + 2]
		];
		output[offset] = approximateColor(original);
	}

	return output;
}

function approximateColor(input: color) {
	let index = 0;
	let minimumDistance = Infinity;

	palette.forEach((paletteColor, paletteIndex) => {
		const distance = Math.sqrt(
			Math.pow(paletteColor[0] - input[0], 2) +
				Math.pow(paletteColor[1] - input[1], 2) +
				Math.pow(paletteColor[2] - input[2], 2)
		);
		if (distance < minimumDistance) {
			index = paletteIndex;
			minimumDistance = distance;
		}
	});

	return index;
}

function encodeFrameArtifact(indexedFrame: Uint8ClampedArray, width: number, height: number) {
	const header = Buffer.from([
		frameFormat.magic.charCodeAt(0),
		frameFormat.magic.charCodeAt(1),
		frameFormat.magic.charCodeAt(2),
		frameFormat.magic.charCodeAt(3),
		width & 0xff,
		(width >> 8) & 0xff,
		height & 0xff,
		(height >> 8) & 0xff
	]);
	return Buffer.concat([header, Buffer.from(indexedFrame)]);
}
