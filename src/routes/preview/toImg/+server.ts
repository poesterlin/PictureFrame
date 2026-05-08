import { dev } from '$app/environment';
import { error, type RequestHandler } from '@sveltejs/kit';
import { Jimp } from 'jimp';
import { db } from '$lib/server/db';
import { isAdminUser } from '$lib/server/admin';
import { pictureFrames, pictures } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
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

function parseFrameId(value: string | null) {
	if (!value) {
		return null;
	}

	const frameId = Number(value);
	if (!Number.isInteger(frameId) || frameId <= 0) {
		return null;
	}

	return frameId;
}

async function resolveFrameForRequest(user: { id: string; username: string }, frameIdParam: string | null) {
	const isAdmin = isAdminUser(user);
	const requestedFrameId = parseFrameId(frameIdParam);

	if (requestedFrameId) {
		const [requestedFrame] = await db
			.select({ id: pictureFrames.id })
			.from(pictureFrames)
			.where(
				isAdmin
					? eq(pictureFrames.id, requestedFrameId)
					: and(eq(pictureFrames.id, requestedFrameId), eq(pictureFrames.ownerUserId, user.id))
			)
			.limit(1);

		if (requestedFrame) {
			return requestedFrame;
		}
	}

	const [fallbackFrame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(isAdmin ? undefined : eq(pictureFrames.ownerUserId, user.id))
		.limit(1);

	return fallbackFrame ?? null;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const key = url.searchParams.get('key');
	const frame = await resolveFrameForRequest(locals.user, url.searchParams.get('frameId'));
	const divisions = dev ? 1 : 2;

	if (!key || !frame) {
		return new Response();
	}

	const pictureScope = and(eq(pictures.fileName, key), eq(pictures.frameId, frame.id));

	const [picture] = await db
		.select({ id: pictures.id })
		.from(pictures)
		.where(pictureScope)
		.limit(1);

	if (!picture) {
		error(404, 'Bild nicht gefunden');
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
