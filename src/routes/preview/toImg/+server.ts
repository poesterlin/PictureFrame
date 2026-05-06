import { dev } from '$app/environment';
import { error, type RequestHandler } from '@sveltejs/kit';
import Jimp from 'jimp';
import { promises as fs } from 'node:fs';
import { decodeFrameArtifactPayload, resolveFrameAbsolutePath } from '../../../../realtime/frame-storage.js';

const PANEL_WIDTH = 800;
const PANEL_HEIGHT = 480;

const palette = [
    toHex(0, 0, 0),
    toHex(255, 255, 255),
    toHex(0, 255, 0),
    toHex(0, 0, 255),
    toHex(255, 0, 0),
    toHex(255, 255, 0),
    toHex(255, 128, 0)
];

function toHex(r: number, g: number, b: number) {
    const pad = (v: string) => v.padStart(2, '0');
    return parseInt(`${pad(r.toString(16))}${pad(g.toString(16))}${pad(b.toString(16))}ff`, 16);
}

function expectedPayloadLength() {
    return PANEL_WIDTH * PANEL_HEIGHT;
}

function renderImage(payload: Uint8Array, divisions: number) {
    return new Promise<Jimp>((resolve, reject) => {
        new Jimp(PANEL_WIDTH / divisions, PANEL_HEIGHT / divisions, (err, image) => {
            if (err || !image) {
                reject(error(500, err?.message || 'failed to build preview image'));
                return;
            }

            for (let i = 0; i < payload.length; i++) {
                const x = i % PANEL_WIDTH;
                const y = Math.floor(i / PANEL_WIDTH);
                const color = palette[payload[i]] ?? palette[0];
                image.setPixelColor(color, Math.floor(x / divisions), Math.floor(y / divisions));
            }

            resolve(image);
        });
    });
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
	if (key.toLowerCase().endsWith('.pf7a') || key.toLowerCase().endsWith('.pf7c')) {
		const decoded = decodeFrameArtifactPayload(array);
		if (!decoded) {
			throw error(400, 'invalid frame artifact file');
		}
		array = decoded;
	} else if (key.toLowerCase().endsWith('.txt')) {
		if (array.length !== PANEL_WIDTH * PANEL_HEIGHT && array.length !== (PANEL_WIDTH * PANEL_HEIGHT) / 2) {
			throw error(400, 'invalid legacy txt frame size');
		}

		if (array.length === (PANEL_WIDTH * PANEL_HEIGHT) / 2) {
			const decoded = Buffer.alloc(PANEL_WIDTH * PANEL_HEIGHT);
			let outPos = 0;
			for (let i = 0; i < array.length; i++) {
				const packed = array[i];
				decoded[outPos++] = (packed >> 4) & 0x0f;
				decoded[outPos++] = packed & 0x0f;
			}
			array = decoded;
		}
	}

	if (array.length !== expectedPayloadLength()) {
		throw error(400, 'invalid frame payload size');
	}

	const converted = await renderImage(array, divisions);

	const headers = new Headers();
	headers.append('content-type', 'image/png');
	headers.append('Cache-Control', 'public, max-age=604800, immutable');
	const response = new Response(await converted.getBufferAsync('image/png'), { headers });

	return response;
};
