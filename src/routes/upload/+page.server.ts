import type { Actions } from './$types';
import sharp from 'sharp';
import type { color } from '$lib/dither';
import { frameFormat, resolveDeviceId, type DisplayUpdateMessage } from '$lib/device-contract';
import { getDeviceBus } from '../../../realtime/device-bus.js';
import { storeFrameArtifacts } from '../../../realtime/frame-storage.js';

export const prerender = false;
const bus = getDeviceBus();

export const actions: Actions = {
	default: async ({ request }: { request: Request }) => {
		const values = await request.formData();

		const name = values.get('name') as string;
		console.log('new image from', name);

		const requestId = (values.get('reqId') as string) || crypto.randomUUID();

		const file = values.get('image') as File;
		const blob = await file.arrayBuffer();
		const txt = await dither(Buffer.from(blob));
		const frame = encodeFrameArtifact(txt, frameFormat.width, frameFormat.height);
		const normalizedRequestId = requestId.replace('.', '');
		const deviceId = resolveDeviceId(values.get('deviceId') as string);

		const stored = await storeFrameArtifacts(
			name,
			normalizedRequestId,
			Buffer.from(txt),
			frame
		);
		console.log('stored local frame', stored.artifactKey);

		const updateMessage: DisplayUpdateMessage = {
			type: 'display',
			deviceId,
			requestId: normalizedRequestId,
			createdAt: new Date().toISOString(),
			artifactKey: stored.artifactKey,
			legacyKey: stored.legacyKey
		};

		bus.publishDisplay(updateMessage);

		console.log('pushed update to websocket bus');
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
