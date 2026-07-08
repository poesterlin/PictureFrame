import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import { getDeviceChannel } from '$lib/server/device/channel';
import { maybeRotate } from '$lib/server/device/rotation';
import { requireFrameAuth } from '../_auth';

const channel = getDeviceChannel();

export const POST: RequestHandler = async (event) => {
	const auth = await requireFrameAuth(event);

	let payload: Record<string, unknown> | null = null;
	try {
		payload = (await event.request.json()) as Record<string, unknown>;
	} catch {
		payload = null;
	}

	if (payload) {
		channel.recordState(auth.frameId, {
			type: 'hello',
			payload,
			receivedAt: new Date().toISOString()
		});
	}

	const updateData: Record<string, unknown> = { lastSeenAt: new Date() };
	if (payload && typeof payload.fwVersion === 'string') {
		updateData.fwVersion = payload.fwVersion;
	}

	await db.update(pictureFrames).set(updateData).where(eq(pictureFrames.id, auth.frameId));

	// On hello (boot), make sure the frame has something to show. maybeRotate
	// handles both "no display yet" and "interval elapsed since last rotation".
	const result = await maybeRotate(auth.frameId);
	console.log(`[hello] frameId=${auth.frameId} rotationResult=`, result);

	return new Response(JSON.stringify(channel.getSnapshot(auth.frameId)), {
		headers: { 'content-type': 'application/json' }
	});
};
