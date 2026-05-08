import type { DisplayUpdateMessage } from '$lib/device-contract';
import { db } from '$lib/server/db';
import { pictureFrames, pictures } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getDeviceChannel } from '$lib/server/device/channel';
import { deleteFrameByKey } from '../../../../realtime/frame-storage.js';

const channel = getDeviceChannel();

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const [frame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(eq(pictureFrames.ownerUserId, locals.user.id))
		.limit(1);

	if (!frame) {
		error(404, 'Kein Rahmen gefunden');
	}

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object' || typeof body.key !== 'string') {
		error(400, 'Missing key');
	}

	const key = body.key;
	const [picture] = await db
		.select({ fileName: pictures.fileName })
		.from(pictures)
		.where(
			and(
				eq(pictures.fileName, key),
				eq(pictures.ownerUserId, locals.user.id),
				eq(pictures.frameId, frame.id)
			)
		)
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

	const [frame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(eq(pictureFrames.ownerUserId, locals.user.id))
		.limit(1);

	if (!frame) {
		error(404, 'Kein Rahmen gefunden');
	}

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object' || typeof body.key !== 'string') {
		error(400, 'Missing key');
	}

	const key = body.key;
	const deletedRows = await db
		.delete(pictures)
		.where(
			and(
				eq(pictures.fileName, key),
				eq(pictures.ownerUserId, locals.user.id),
				eq(pictures.frameId, frame.id)
			)
		)
		.returning({ id: pictures.id });

	if (deletedRows.length === 0) {
		error(404, 'Bild nicht gefunden');
	}

	await deleteFrameByKey(key);
	return json({ ok: true });
};
