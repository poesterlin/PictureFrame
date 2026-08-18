import { isAdminUser } from '$lib/server/admin';
import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';

type User = { id: string; username: string };

export async function listAccessibleFrames(user: User) {
	const isAdmin = isAdminUser(user);
	const query = db
		.select({
			id: pictureFrames.id,
			frameName: pictureFrames.frameName,
			refreshEverySeconds: pictureFrames.refreshEverySeconds
		})
		.from(pictureFrames)
		.orderBy(asc(pictureFrames.frameName));
	return {
		isAdmin,
		frames: isAdmin ? await query : await query.where(eq(pictureFrames.ownerUserId, user.id))
	};
}

export async function resolveAccessibleFrame(user: User, requestedId: number | null) {
	const { isAdmin, frames } = await listAccessibleFrames(user);
	const selected =
		(requestedId ? frames.find((frame) => frame.id === requestedId) : null) ?? frames[0] ?? null;
	return { isAdmin, frames, frame: selected };
}

export function activeFrameIdFrom(cookies: Cookies, requestedId: number | null) {
	return requestedId ?? (Number(cookies.get('active-frame-id')) || null);
}

export function setActiveFrameCookie(cookies: Cookies, frameId: number, secure: boolean) {
	cookies.set('active-frame-id', String(frameId), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 60 * 24 * 365
	});
}

export async function canAccessFrame(user: User, frameId: number) {
	const conditions = [eq(pictureFrames.id, frameId)];
	if (!isAdminUser(user)) conditions.push(eq(pictureFrames.ownerUserId, user.id));
	const [frame] = await db
		.select({ id: pictureFrames.id, frameName: pictureFrames.frameName })
		.from(pictureFrames)
		.where(and(...conditions))
		.limit(1);
	return frame ?? null;
}
