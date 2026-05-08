import type { RequestHandler } from './$types';
import { getDeviceChannel } from '$lib/server/device/channel';
import { pickRandomPictureForFrame } from '$lib/server/device/picker';
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

	const snapshot = channel.getSnapshot(auth.frameId);
	if (!snapshot.display) {
		const picked = await pickRandomPictureForFrame(auth.frameId);
		if (picked) {
			channel.publishDisplay(auth.frameId, {
				type: 'display',
				requestId: crypto.randomUUID(),
				createdAt: new Date().toISOString(),
				artifactKey: picked.artifactKey
			});
		}
	}

	return new Response(JSON.stringify(channel.getSnapshot(auth.frameId)), {
		headers: { 'content-type': 'application/json' }
	});
};
