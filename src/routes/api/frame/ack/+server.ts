import type { RequestHandler } from './$types';
import { getDeviceChannel } from '$lib/server/device/channel';
import { requireFrameAuth } from '../_auth';

const channel = getDeviceChannel();

export const POST: RequestHandler = async (event) => {
	const auth = await requireFrameAuth(event);
	const body = (await event.request.json().catch(() => null)) as { cursor?: unknown } | null;
	const cursorValue = Number(body?.cursor);

	if (!Number.isFinite(cursorValue) || cursorValue < 0) {
		return new Response(JSON.stringify({ ok: false, error: 'Invalid cursor' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	channel.ack(auth.frameId, Math.floor(cursorValue));
	return new Response(JSON.stringify({ ok: true }), {
		headers: { 'content-type': 'application/json' }
	});
};
