import { dev } from '$app/environment';
import { error, type RequestHandler } from '@sveltejs/kit';
import { Jimp } from 'jimp';
import {
	decodeFrameArtifactPayload,
	ensureFrameArtifactFile,
	resolveFrameAbsolutePath
} from '../../../../realtime/frame-storage.js';

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
    const image = new Jimp({
        width: PANEL_WIDTH / divisions,
        height: PANEL_HEIGHT / divisions,
        color: palette[0]
    });

    for (let i = 0; i < payload.length; i++) {
        const x = i % PANEL_WIDTH;
        const y = Math.floor(i / PANEL_WIDTH);
        const color = palette[payload[i]] ?? palette[0];
        image.setPixelColor(color, Math.floor(x / divisions), Math.floor(y / divisions));
    }

    return image;
}

export const GET: RequestHandler = async ({ url }) => {
	const key = url.searchParams.get('key');
	const divisions = dev ? 1 : 2;

	if (!key) {
		return new Response();
	}

	const filePath = resolveFrameAbsolutePath(key);
	if (!filePath) {
		error(400, 'invalid key');
	}

	const artifactPayload = await ensureFrameArtifactFile(filePath);
	if (!artifactPayload) {
		error(400, 'invalid frame artifact file');
	}

	const array = decodeFrameArtifactPayload(artifactPayload);
	if (!array) {
		error(400, 'invalid frame artifact file');
	}

	if (array.length !== expectedPayloadLength()) {
		error(400, 'invalid frame payload size');
	}

	const converted = await renderImage(array, divisions);

	const headers = new Headers();
	headers.append('content-type', 'image/png');
	headers.append('Cache-Control', 'public, max-age=604800, immutable');
	const pngBuffer = await converted.getBuffer('image/png');
	const response = new Response(new Uint8Array(pngBuffer), { headers });

	return response;
};
