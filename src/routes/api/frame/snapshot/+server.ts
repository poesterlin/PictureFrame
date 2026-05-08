import type { RequestHandler } from './$types';
import { getDeviceChannel } from '$lib/server/device/channel';
import { requireFrameAuth } from '../_auth';

const channel = getDeviceChannel();

export const GET: RequestHandler = async (event) => {
	const auth = await requireFrameAuth(event);

	return new Response(JSON.stringify(channel.getSnapshot(auth.frameId)), {
		headers: { 'content-type': 'application/json' }
	});
};
