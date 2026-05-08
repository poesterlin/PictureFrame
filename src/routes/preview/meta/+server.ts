import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { isAdminUser } from '$lib/server/admin';
import { pictureFrames, pictures } from '$lib/server/db/schema';

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

async function resolveFrameForRequest(user: { id: string; username: string }, frameIdParam: string | null) {
	const isAdmin = isAdminUser(user);
	const requestedFrameId = parseFrameId(frameIdParam);

	if (requestedFrameId) {
		const [requestedFrame] = await db
			.select({ id: pictureFrames.id })
			.from(pictureFrames)
			.where(
				isAdmin
					? eq(pictureFrames.id, requestedFrameId)
					: and(eq(pictureFrames.id, requestedFrameId), eq(pictureFrames.ownerUserId, user.id))
			)
			.limit(1);

		if (requestedFrame) {
			return requestedFrame;
		}
	}

	const [fallbackFrame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(isAdmin ? undefined : eq(pictureFrames.ownerUserId, user.id))
		.limit(1);

	return fallbackFrame ?? null;
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const frame = await resolveFrameForRequest(locals.user, url.searchParams.get('frameId'));

	if (!frame) {
		return json({ ok: true, flagsByKey: {} });
	}

	const rows = await db
		.select({ fileName: pictures.fileName, favorite: pictures.favorite, skipped: pictures.skipped })
		.from(pictures)
		.where(
			isAdminUser(locals.user)
				? eq(pictures.frameId, frame.id)
				: and(eq(pictures.ownerUserId, locals.user.id), eq(pictures.frameId, frame.id))
		);

	const flagsByKey = Object.fromEntries(
		rows.map((row) => [row.fileName, { favorite: row.favorite, skipped: row.skipped }])
	);

	return json({ ok: true, flagsByKey });
};

export const PATCH: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const frame = await resolveFrameForRequest(locals.user, url.searchParams.get('frameId'));

	if (!frame) {
		error(404, 'Kein Rahmen gefunden');
	}

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object') {
		error(400, 'Invalid JSON body');
	}

	const key = typeof body.key === 'string' ? body.key : '';
	const hasFavorite = typeof body.favorite === 'boolean';
	const hasSkipped = typeof body.skipped === 'boolean';

	if (!key || (!hasFavorite && !hasSkipped)) {
		error(400, 'Missing key or flags');
	}

	const [current] = await db
		.select({ id: pictures.id, favorite: pictures.favorite, skipped: pictures.skipped })
		.from(pictures)
		.where(
			isAdminUser(locals.user)
				? and(eq(pictures.fileName, key), eq(pictures.frameId, frame.id))
				: and(
					eq(pictures.fileName, key),
					eq(pictures.ownerUserId, locals.user.id),
					eq(pictures.frameId, frame.id)
				)
		)
		.limit(1);

	if (!current) {
		error(404, 'Bild nicht gefunden');
	}

	const next = {
		favorite: hasFavorite ? (body.favorite as boolean) : current.favorite,
		skipped: hasSkipped ? (body.skipped as boolean) : current.skipped
	};

	await db.update(pictures).set(next).where(eq(pictures.id, current.id));

	return json({ ok: true, key, ...next });
};
