import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { pictureFrames, pictures } from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';


export const prerender = false;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login?redirect=%2Fpreview');
	}

	const [frame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(eq(pictureFrames.ownerUserId, locals.user.id))
		.limit(1);

	if (!frame) {
		return { keys: [], flagsByKey: {} };
	}

	const rows = await db
		.select({
			fileName: pictures.fileName,
			favorite: pictures.favorite,
			skipped: pictures.skipped
		})
		.from(pictures)
		.where(and(eq(pictures.ownerUserId, locals.user.id), eq(pictures.frameId, frame.id)))
		.orderBy(desc(pictures.createdAt));

	const keys = rows.map((row) => row.fileName);
	const flagsByKey = Object.fromEntries(
		rows.map((row) => [row.fileName, { favorite: row.favorite, skipped: row.skipped }])
	);

	return { keys, flagsByKey };
};
