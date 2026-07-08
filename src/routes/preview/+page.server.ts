import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { isAdminUser } from '$lib/server/admin';
import { pictureFrames, pictures } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';

export const prerender = false;

function parseFrameId(value: string | null) {
	if (!value) {
		return null;
	}

	const frameId = Number(value);
	if (!Number.isInteger(frameId) || frameId <= 0) {
		return null;
	}

	return frameId;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(302, '/login?redirect=%2Fpreview');
	}

	const isAdmin = isAdminUser(locals.user);
	const requestedFrameId = parseFrameId(url.searchParams.get('frameId'));

	const frames = await db
		.select({
			id: pictureFrames.id,
			frameName: pictureFrames.frameName
		})
		.from(pictureFrames)
		.where(isAdmin ? undefined : eq(pictureFrames.ownerUserId, locals.user.id));

	const selectedFrame =
		(requestedFrameId ? frames.find((frame) => frame.id === requestedFrameId) : null) ??
		frames[0] ??
		null;

	if (!selectedFrame) {
		if (!isAdmin) {
			throw redirect(302, '/');
		}

		return {
			isAdmin,
			frames,
			activeFrameId: null,
			keys: [],
			flagsByKey: {}
		};
	}

	const picturesFilter = eq(pictures.frameId, selectedFrame.id);

	const rows = await db
		.select({
			fileName: pictures.fileName,
			favorite: pictures.favorite,
			skipped: pictures.skipped
		})
		.from(pictures)
		.where(picturesFilter)
		.orderBy(desc(pictures.createdAt));

	const keys = rows.map((row) => row.fileName);
	const flagsByKey = Object.fromEntries(
		rows.map((row) => [row.fileName, { favorite: row.favorite, skipped: row.skipped }])
	);

	return {
		isAdmin,
		frames,
		activeFrameId: selectedFrame.id,
		keys,
		flagsByKey
	};
};
