import type { RequestHandler } from './$types';
import { getDeviceChannel } from '$lib/server/device/channel';
import { maybeRotate } from '$lib/server/device/rotation';
import { requireFrameAuth } from '../_auth';

const channel = getDeviceChannel();

export const POST: RequestHandler = async (event) => {
	const auth = await requireFrameAuth(event);
	const payload = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;

	channel.recordState(auth.frameId, {
		type: 'state',
		payload,
		receivedAt: new Date().toISOString()
	});

	// Heartbeat is the regular tick the device uses for liveness + event
	// catch-up. The server (not the device) decides when it's time to rotate
	// to a new picture.
	const outcome = await maybeRotate(auth.frameId);
	if (outcome.rotated) {
		console.log(`[rotation] frame=${auth.frameId} -> ${outcome.artifactKey}`);
	}

	return new Response(JSON.stringify({ ok: true }), {
		headers: { 'content-type': 'application/json' }
	});
};
