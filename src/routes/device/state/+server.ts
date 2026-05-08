import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import { getDeviceChannel } from '$lib/server/device/channel';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

const channel = getDeviceChannel();

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const [frame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(eq(pictureFrames.ownerUserId, locals.user.id))
		.limit(1);

	if (!frame) {
		error(404, 'No frame linked to your account');
	}

	const state = channel.getLastState(frame.id);
	return new Response(JSON.stringify({ state }), {
		headers: { 'content-type': 'application/json' }
	});
};
