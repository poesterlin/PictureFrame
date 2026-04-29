import {
	resolveDeviceId,
	type DeviceCommandMessage,
	type DisplayUpdateMessage
} from '$lib/device-contract';
import type { RequestHandler } from '@sveltejs/kit';
import { getDeviceBus } from '../../../realtime/device-bus.js';
import { deleteFrameByKey, pickRandomArtifactKey } from '../../../realtime/frame-storage.js';

const bus = getDeviceBus();

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Record<string, unknown>;
	const deviceId = resolveDeviceId(body.deviceId as string | undefined);

	if (typeof body.key === 'string' || typeof body.artifactKey === 'string') {
		const message: DisplayUpdateMessage = {
			type: 'display',
			deviceId,
			requestId: typeof body.requestId === 'string' ? body.requestId : crypto.randomUUID(),
			createdAt: new Date().toISOString(),
			artifactKey: typeof body.artifactKey === 'string' ? body.artifactKey : body.key as string,
			legacyKey: typeof body.key === 'string' ? body.key : undefined
		};
		bus.publishDisplay(message);
		return new Response(JSON.stringify({ ok: true }));
	}

	if (typeof body.command === 'string') {
		if (body.command === 'refreshNow' || body.command === 'syncNow') {
			const artifactKey = await pickRandomArtifactKey();
			if (!artifactKey) {
				return new Response(JSON.stringify({ ok: false, error: 'No local frames available' }), {
					status: 404
				});
			}
			bus.publishDisplay({
				type: 'display',
				deviceId,
				requestId: crypto.randomUUID(),
				createdAt: new Date().toISOString(),
				artifactKey
			});
			return new Response(JSON.stringify({ ok: true, artifactKey }));
		}

		const message: DeviceCommandMessage = {
			type: 'command',
			deviceId,
			[body.command]: true
		} as DeviceCommandMessage;
		bus.publishCommand(message);
		return new Response(JSON.stringify({ ok: true }));
	}

	console.log('sent command payload', body);

	return new Response();
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { key?: string };
	if (!body?.key) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing key' }), { status: 400 });
	}

	const deleted = await deleteFrameByKey(body.key);
	return new Response(JSON.stringify({ ok: deleted }));
};
