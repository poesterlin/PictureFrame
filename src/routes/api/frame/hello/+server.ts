import type { RequestHandler } from './$types';
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

	// On hello (boot), make sure the frame has something to show. maybeRotate
	// handles both "no display yet" and "interval elapsed since last rotation".
	await maybeRotate(auth.frameId);

	return new Response(JSON.stringify(channel.getSnapshot(auth.frameId)), {
		headers: { 'content-type': 'application/json' }
	});
};
