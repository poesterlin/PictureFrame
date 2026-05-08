import type { DeviceCommandMessage, DisplayUpdateMessage } from '$lib/device-contract';
import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import { getDeviceChannel } from '$lib/server/device/channel';
import { pickRandomPictureForFrame } from '$lib/server/device/picker';
import { eq } from 'drizzle-orm';
import { error, type RequestHandler } from '@sveltejs/kit';
import { deleteFrameByKey } from '../../../realtime/frame-storage.js';

const channel = getDeviceChannel();

async function requireOwnedFrameId(userId: string): Promise<number> {
	const [frame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(eq(pictureFrames.ownerUserId, userId))
		.limit(1);

	if (!frame) {
		error(404, 'No frame linked to your account');
	}

	return frame.id;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const frameId = await requireOwnedFrameId(locals.user.id);
	const body = (await request.json()) as Record<string, unknown>;

	if (typeof body.key === 'string' || typeof body.artifactKey === 'string') {
		const resolvedArtifactKey = typeof body.artifactKey === 'string'
			? body.artifactKey
			: (body.key as string).replace(/\.[^./]+$/i, '.pf7a');
		const message: DisplayUpdateMessage = {
			type: 'display',
			requestId: typeof body.requestId === 'string' ? body.requestId : crypto.randomUUID(),
			createdAt: new Date().toISOString(),
			artifactKey: resolvedArtifactKey,
			legacyKey: typeof body.key === 'string' ? body.key : undefined
		};
		channel.publishDisplay(frameId, message);
		return new Response(JSON.stringify({ ok: true }));
	}

	if (typeof body.command === 'string') {
		if (body.command === 'refreshNow' || body.command === 'syncNow') {
			const picked = await pickRandomPictureForFrame(frameId);
			const artifactKey = picked?.artifactKey;
			if (!artifactKey) {
				return new Response(JSON.stringify({ ok: false, error: 'No local frames available' }), {
					status: 404
				});
			}
			channel.publishDisplay(frameId, {
				type: 'display',
				requestId: crypto.randomUUID(),
				createdAt: new Date().toISOString(),
				artifactKey
			});
			return new Response(JSON.stringify({ ok: true, artifactKey }));
		}

		const message: DeviceCommandMessage = {
			type: 'command',
			[body.command]: true
		} as DeviceCommandMessage;
		channel.publishCommand(frameId, message);
		return new Response(JSON.stringify({ ok: true }));
	}

	console.log('sent command payload', body);

	return new Response();
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const body = (await request.json()) as { key?: string };
	if (!body?.key) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing key' }), { status: 400 });
	}

	const deleted = await deleteFrameByKey(body.key);
	return new Response(JSON.stringify({ ok: deleted }));
};
