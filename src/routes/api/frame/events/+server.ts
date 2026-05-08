import type { RequestHandler } from './$types';
import { getDeviceChannel } from '$lib/server/device/channel';
import { requireFrameAuth } from '../_auth';

const channel = getDeviceChannel();
const MAX_WAIT_MS = 30_000;

function parseInteger(input: string | null, fallback = 0): number {
	if (!input) {
		return fallback;
	}
	const value = Number(input);
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.floor(value));
}

export const GET: RequestHandler = async (event) => {
	const auth = await requireFrameAuth(event);
	const after = parseInteger(event.url.searchParams.get('after'));
	const wait = Math.min(parseInteger(event.url.searchParams.get('wait')), MAX_WAIT_MS);

	const result = await channel.getEventsSince(auth.frameId, after, wait);
	return new Response(JSON.stringify(result), {
		headers: { 'content-type': 'application/json' }
	});
};
