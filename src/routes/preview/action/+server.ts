import type { DisplayUpdateMessage } from '$lib/device-contract';
import { db } from '$lib/server/db';
import { isAdminUser } from '$lib/server/admin';
import { pictureFrames, pictures } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getDeviceChannel } from '$lib/server/device/channel';
import { deleteFrameByKey } from '../../../../realtime/frame-storage.js';

const channel = getDeviceChannel();

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

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const frame = await resolveFrameForRequest(locals.user, new URL(request.url).searchParams.get('frameId'));

	if (!frame) {
		error(404, 'Kein Rahmen gefunden');
	}

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object' || typeof body.key !== 'string') {
		error(400, 'Missing key');
	}

	const key = body.key;
	const pictureScope = and(eq(pictures.fileName, key), eq(pictures.frameId, frame.id));

	const [picture] = await db
		.select({ fileName: pictures.fileName })
		.from(pictures)
		.where(pictureScope)
		.limit(1);

	if (!picture) {
		error(404, 'Bild nicht gefunden');
	}

	const message: DisplayUpdateMessage = {
		type: 'display',
		requestId: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		artifactKey: picture.fileName
	};
	channel.publishDisplay(frame.id, message);

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const frame = await resolveFrameForRequest(locals.user, new URL(request.url).searchParams.get('frameId'));

	if (!frame) {
		error(404, 'Kein Rahmen gefunden');
	}

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object' || typeof body.key !== 'string') {
		error(400, 'Missing key');
	}

	const key = body.key;
	const deleteScope = and(eq(pictures.fileName, key), eq(pictures.frameId, frame.id));

	const deletedRows = await db
		.delete(pictures)
		.where(deleteScope)
		.returning({ id: pictures.id });

	if (deletedRows.length === 0) {
		error(404, 'Bild nicht gefunden');
	}

	await deleteFrameByKey(key);
	return json({ ok: true });
};
