import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { frameClaimCodes, pictureFrames } from '$lib/server/db/schema';
import { generatePairingCode, sha256Hex } from '$lib/server/frame-auth';
import {
	CLAIMED_FRAME_REFRESH_SECONDS,
	UNCLAIMED_FRAME_REFRESH_SECONDS
} from '$lib/server/frame-defaults';

const DEFAULT_CLAIM_TTL_HOURS = 24 * 14;

function normalizeCode(value: string) {
	return value.trim().toUpperCase();
}

export function generateFrameClaimCode() {
	const raw = generatePairingCode(12);
	return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export async function createFrameClaimCodeForOwner(
	frameId: number,
	options?: { ttlHours?: number }
) {
	const [frame] = await db
		.select({ id: pictureFrames.id })
		.from(pictureFrames)
		.where(and(eq(pictureFrames.id, frameId), isNull(pictureFrames.ownerUserId)))
		.limit(1);

	if (!frame) {
		return null;
	}

	const ttlHours = Math.max(1, Math.min(24 * 30, Math.floor(options?.ttlHours ?? DEFAULT_CLAIM_TTL_HOURS)));

	const now = new Date();
	const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
	const code = generateFrameClaimCode();
	const normalizedCode = normalizeCode(code);

	await db.insert(frameClaimCodes).values({
		frameId,
		codeHash: sha256Hex(normalizedCode),
		expiresAt,
		claimedByUserId: null,
		claimedAt: null,
		disabled: false,
		createdAt: now
	});

	return {
		code,
		expiresAt
	};
}

export async function listFrameClaimCodesByOwner() {
	return db
		.select({
			id: frameClaimCodes.id,
			frameId: frameClaimCodes.frameId,
			expiresAt: frameClaimCodes.expiresAt,
			claimedAt: frameClaimCodes.claimedAt,
			disabled: frameClaimCodes.disabled,
			createdAt: frameClaimCodes.createdAt,
			frameName: pictureFrames.frameName
		})
		.from(frameClaimCodes)
		.innerJoin(pictureFrames, eq(frameClaimCodes.frameId, pictureFrames.id))
		.where(isNull(pictureFrames.ownerUserId))
		.orderBy(desc(frameClaimCodes.createdAt));
}

export async function disableFrameClaimCodeForOwner(codeId: number) {
	const [row] = await db
		.select({ id: frameClaimCodes.id })
		.from(frameClaimCodes)
		.innerJoin(pictureFrames, eq(frameClaimCodes.frameId, pictureFrames.id))
		.where(and(eq(frameClaimCodes.id, codeId), isNull(pictureFrames.ownerUserId)))
		.limit(1);

	if (!row) {
		return false;
	}

	await db.update(frameClaimCodes).set({ disabled: true }).where(eq(frameClaimCodes.id, codeId));
	return true;
}

export async function deleteDisabledFrameClaimCodeForOwner(codeId: number) {
	const [row] = await db
		.select({ id: frameClaimCodes.id })
		.from(frameClaimCodes)
		.innerJoin(pictureFrames, eq(frameClaimCodes.frameId, pictureFrames.id))
		.where(
			and(
				eq(frameClaimCodes.id, codeId),
				eq(frameClaimCodes.disabled, true),
				isNull(pictureFrames.ownerUserId)
			)
		)
		.limit(1);

	if (!row) {
		return false;
	}

	await db.delete(frameClaimCodes).where(eq(frameClaimCodes.id, codeId));
	return true;
}

type ClaimResult =
	| { ok: true; frameId: number; frameName: string }
	| { ok: false; reason: 'invalid_or_expired' | 'already_claimed' | 'already_has_frame' | 'transfer_failed' };

export async function claimFrameByCode(rawCode: string, claimantUserId: string): Promise<ClaimResult> {
	const normalizedCode = normalizeCode(rawCode);
	if (!normalizedCode) {
		return { ok: false, reason: 'invalid_or_expired' };
	}

	const now = new Date();

	try {
		return await db.transaction(async (tx) => {
			const [current] = await tx
				.select({
					id: frameClaimCodes.id,
					frameId: frameClaimCodes.frameId,
					claimedAt: frameClaimCodes.claimedAt,
					disabled: frameClaimCodes.disabled,
					expiresAt: frameClaimCodes.expiresAt,
					frameName: pictureFrames.frameName
				})
				.from(frameClaimCodes)
				.innerJoin(pictureFrames, eq(frameClaimCodes.frameId, pictureFrames.id))
				.where(eq(frameClaimCodes.codeHash, sha256Hex(normalizedCode)))
				.limit(1);

			if (!current || current.disabled || current.expiresAt.getTime() <= now.getTime()) {
				return { ok: false as const, reason: 'invalid_or_expired' as const };
			}

			if (current.claimedAt) {
				return { ok: false as const, reason: 'already_claimed' as const };
			}

			const [alreadyOwns] = await tx
				.select({ id: pictureFrames.id })
				.from(pictureFrames)
				.where(eq(pictureFrames.ownerUserId, claimantUserId))
				.limit(1);

			if (alreadyOwns) {
				return { ok: false as const, reason: 'already_has_frame' as const };
			}

			const claimed = await tx
				.update(frameClaimCodes)
				.set({
					claimedByUserId: claimantUserId,
					claimedAt: now,
					disabled: true
				})
				.where(
					and(
						eq(frameClaimCodes.id, current.id),
						eq(frameClaimCodes.disabled, false),
						gt(frameClaimCodes.expiresAt, now),
						isNull(frameClaimCodes.claimedAt)
					)
				)
				.returning({ id: frameClaimCodes.id });

			if (claimed.length === 0) {
				return { ok: false as const, reason: 'already_claimed' as const };
			}

			const transferred = await tx
				.update(pictureFrames)
				.set({ ownerUserId: claimantUserId, updatedAt: now })
				.where(eq(pictureFrames.id, current.frameId))
				.returning({ id: pictureFrames.id });

			if (transferred.length === 0) {
				throw new Error('transfer_failed');
			}

			// Bump the rotation interval from the unclaimed default to the
			// claimed default, but only if the frame is still at the unclaimed
			// default (i.e., nobody manually changed it).
			await tx
				.update(pictureFrames)
				.set({ refreshEverySeconds: CLAIMED_FRAME_REFRESH_SECONDS, updatedAt: now })
				.where(
					and(
						eq(pictureFrames.id, current.frameId),
						eq(pictureFrames.refreshEverySeconds, UNCLAIMED_FRAME_REFRESH_SECONDS)
					)
				);

			return {
				ok: true as const,
				frameId: current.frameId,
				frameName: current.frameName
			};
		});
	} catch {
		return { ok: false, reason: 'transfer_failed' };
	}
}
