import type { Actions } from './$types';
import { PutObjectCommand, type PutObjectCommandInput } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type { color } from '$lib/dither';
import { mqttClient, commands, sendMqtt } from '$lib/mqtt';
import { env } from '$env/dynamic/private';
import { s3Client } from '$lib/s3';

export const prerender = false;

export const actions: Actions = {
	default: async ({ request }: { request: Request }) => {
		const values = await request.formData();

		const name = values.get('name') as string;
		console.log('new image from', name);

		const requestId = values.get('reqId') as string;

		const file = values.get('image') as File;
		const blob = await file.arrayBuffer();
		const txt = await dither(Buffer.from(blob));

		const key = `submitions/${name}/${requestId.replace('.', '')}.txt`;
		const params: PutObjectCommandInput = {
			Bucket: env.S3_BUCKET,
			Key: key,
			Body: Buffer.from(txt),
			ACL: 'public-read',
			Metadata: {
				'Content-type': 'text/plain'
			}
		};

		await s3Client.send(new PutObjectCommand(params));
		console.log('uploaded', key);

		await sendMqtt(commands.update, key)

		console.log('messaged mqtt');
	}
};

async function dither(input: Uint8Array) {
	const inputRaw = await sharp(input)
		.ensureAlpha()
		.resize(800, 480, {
			fit: sharp.fit.outside
		})
		.raw()
		.toBuffer();

	const palette = [
		[0, 0, 0],
		[255, 255, 255],
		[0, 255, 0],
		[0, 0, 255],
		[255, 0, 0],
		[255, 255, 0],
		[255, 128, 0]
	] as color[];

	return atkinsonDither(inputRaw, palette, 800, 480);
}

function atkinsonDither(uint8data: Uint8Array, palette: color[], w: number, h: number) {
	const data = new Uint8ClampedArray(uint8data);
	const out = new Uint8ClampedArray(w * h);

	const byteIdx = function (x: number, y: number) {
		return 4 * x + 4 * y * w;
	};

	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const pix = byteIdx(x, y);

			const original: color = [data[pix], data[pix + 1], data[pix + 2]];
			const idx = approximateColor(original, palette);
			set(out, x + y * w, idx);
		}
	}
	return out;
}

function set(buffer: Uint8ClampedArray, address: number, value: number) {
	if (address < 0 || address > buffer.length) {
		return;
	}
	buffer[address] = value;
}

function approximateColor(color: color, palette: color[]) {
	let idx = 0;
	let minDist = Infinity;
	palette.forEach((paletteColor, i) => {
		const dist = colorDistance(paletteColor, color);
		if (dist < minDist) {
			idx = i;
			minDist = dist;
		}
	});

	return idx;
}

function colorDistance(a: color, b: color) {
	return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2));
}
