import { isAdminUser } from '$lib/server/admin';
import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

type SessionUser = { id: string; username: string } | null;

export type ResolvedPreviewFrame = {
	id: number;
	scope: 'owner' | 'admin-unclaimed';
};

function parseRequestedFrameId(rawFrameId: string | null) {
	if (!rawFrameId) return null;
	const parsed = Number(rawFrameId);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null;
	}
	return parsed;
}

export async function resolvePreviewFrame(
	user: SessionUser,
	rawFrameId: string | null,
	options?: { strictRequestedForAdmin?: boolean }
): Promise<ResolvedPreviewFrame | null> {
	if (!user) return null;

	const isAdmin = isAdminUser(user);
	const requestedFrameId = parseRequestedFrameId(rawFrameId);
	const strictRequestedForAdmin = options?.strictRequestedForAdmin ?? false;

	if (isAdmin && requestedFrameId !== null) {
		const [requestedFrame] = await db
			.select({ id: pictureFrames.id })
			.from(pictureFrames)
			.where(and(eq(pictureFrames.id, requestedFrameId), isNull(pictureFrames.ownerUserId)))
			.limit(1);

		if (requestedFrame) {
			return { id: requestedFrame.id, scope: 'admin-unclaimed' };
		}

		if (strictRequestedForAdmin) {
			return null;
		}
	}

	const [ownerFrame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(eq(pictureFrames.ownerUserId, user.id))
		.limit(1);

	if (!ownerFrame) {
		return null;
	}

	return { id: ownerFrame.id, scope: 'owner' };
}
