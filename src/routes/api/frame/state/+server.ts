import type { RequestHandler } from './$types';
import { getDeviceChannel } from '$lib/server/device/channel';
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

	return new Response(JSON.stringify({ ok: true }), {
		headers: { 'content-type': 'application/json' }
	});
};
