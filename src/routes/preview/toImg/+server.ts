import { dev } from '$app/environment';
import { error, type RequestHandler } from '@sveltejs/kit';
import Jimp from 'jimp';
import { promises as fs } from 'node:fs';
import { resolveFrameAbsolutePath } from '../../../../realtime/frame-storage.js';

const palette = [
    toHex(0, 0, 0),
    toHex(255, 255, 255),
    toHex(0, 255, 0),
    toHex(0, 0, 255),
    toHex(255, 0, 0),
    toHex(255, 255, 0),
    toHex(255, 128, 0)
]

function toHex(r: number, g: number, b: number) {
    const pad = (v: string) => v.padStart(2, "0")
    return parseInt(`${pad(r.toString(16))}${pad(g.toString(16))}${pad(b.toString(16))}ff`, 16)
}

function byteIdx(index: number) {
    const x = index % 800
    const y = index / 800;
    return [x, y] as [number, number]
}

export const GET: RequestHandler = async ({ url }) => {
	const key = url.searchParams.get('key');
	const divisions = dev ? 1 : 2;

	if (!key) {
		return new Response();
	}

	const filePath = resolveFrameAbsolutePath(key);
	if (!filePath) {
		throw error(400, 'invalid key');
	}

	let array = await fs.readFile(filePath);
	if (key.toLowerCase().endsWith('.pf7a')) {
		if (array.length < 8) {
			throw error(400, 'invalid pf7a file');
		}
		array = array.subarray(8);
	}

	const imageData = Array.from(array).map((color) => palette[color] ?? palette[0]);

	const converted: Jimp = await new Promise((res) => {
		new Jimp(800 / divisions, 480 / divisions, (err, image) => {
			if (err) {
				throw error(500, err.message);
			}

			imageData.forEach((value, i) => {
				const [x, y] = byteIdx(i);
				image.setPixelColor(value, Math.floor(x / divisions), Math.floor(y / divisions));
			});

			res(image);
		});
	});

	const headers = new Headers();
	headers.append('content-type', 'image/png');
	headers.append('Cache-Control', 'max-age=604800');
	const response = new Response(await converted.getBufferAsync('image/png'), { headers });

	return response;
};
