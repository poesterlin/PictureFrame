import { db } from '$lib/server/db';
import { isAdminUser } from '$lib/server/admin';
import { pictureFrames } from '$lib/server/db/schema';
import { redirect } from '@sveltejs/kit';
import { eq, isNull } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login?redirect=%2Fconnect');
	}

	const isAdmin = isAdminUser(locals.user);

	const frames = await db
		.select({
			id: pictureFrames.id,
			frameName: pictureFrames.frameName,
			authKey: pictureFrames.authKey
		})
		.from(pictureFrames)
		.where(isAdmin ? undefined : eq(pictureFrames.ownerUserId, locals.user.id));

	return { frames, isAdmin };
};
