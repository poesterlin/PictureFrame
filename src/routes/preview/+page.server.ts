import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { pictures } from '$lib/server/db/schema';
import {
	activeFrameIdFrom,
	resolveAccessibleFrame,
	setActiveFrameCookie
} from '$lib/server/frame-access';
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

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user) {
		throw redirect(302, '/login?redirect=%2Fpreview');
	}

	const requestedFrameId = activeFrameIdFrom(
		cookies,
		parseFrameId(url.searchParams.get('frameId'))
	);
	const {
		frame: selectedFrame,
		frames,
		isAdmin
	} = await resolveAccessibleFrame(locals.user, requestedFrameId);
	if (isAdmin && selectedFrame) {
		setActiveFrameCookie(cookies, selectedFrame.id, url.protocol === 'https:');
	}

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
