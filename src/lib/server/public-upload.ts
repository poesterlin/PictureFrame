import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { pictureFrames, publicUploadLinks } from '$lib/server/db/schema';
import { generatePairingCode, sha256Hex } from '$lib/server/frame-auth';

const DEFAULT_LINK_TTL_HOURS = 24 * 365 * 10;

function normalizeCode(value: string) {
	return value.trim().toUpperCase();
}

export function generatePublicUploadCode() {
	const raw = generatePairingCode(12);
	return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export async function createPublicUploadLink(frameId: number) {
	const ttlHours = DEFAULT_LINK_TTL_HOURS;
	const now = new Date();
	const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
	const code = generatePublicUploadCode();
	const normalizedCode = normalizeCode(code);

	await db.insert(publicUploadLinks).values({
		frameId,
		codeHash: sha256Hex(normalizedCode),
		expiresAt,
		maxUploads: 0,
		uploadCount: 0,
		disabled: false,
		createdAt: now
	});

	return {
		code,
		expiresAt
	};
}

export async function getLinkForUploadCode(uploadCode: string) {
	const normalizedCode = normalizeCode(uploadCode);
	const hash = sha256Hex(normalizedCode);

	const [link] = await db
		.select({
			id: publicUploadLinks.id,
			frameId: publicUploadLinks.frameId,
			disabled: publicUploadLinks.disabled
		})
		.from(publicUploadLinks)
		.innerJoin(pictureFrames, eq(publicUploadLinks.frameId, pictureFrames.id))
		.where(eq(publicUploadLinks.codeHash, hash))
		.limit(1);

	if (!link || link.disabled) {
		return null;
	}

	return link;
}

export async function consumeUploadLink(linkId: number) {
	await db
		.update(publicUploadLinks)
		.set({
			uploadCount: sql`${publicUploadLinks.uploadCount} + 1`
		})
		.where(and(eq(publicUploadLinks.id, linkId), eq(publicUploadLinks.disabled, false)));
}

export async function disableUploadLink(linkId: number) {
	await db.update(publicUploadLinks).set({ disabled: true }).where(eq(publicUploadLinks.id, linkId));
}

export async function deleteUploadLink(linkId: number) {
	await db.delete(publicUploadLinks).where(eq(publicUploadLinks.id, linkId));
}

export async function listPublicUploadLinksByOwner(ownerUserId: string) {
	return db
		.select({
			id: publicUploadLinks.id,
			frameId: publicUploadLinks.frameId,
			uploadCount: publicUploadLinks.uploadCount,
			disabled: publicUploadLinks.disabled,
			frameName: pictureFrames.frameName
		})
		.from(publicUploadLinks)
		.innerJoin(pictureFrames, eq(publicUploadLinks.frameId, pictureFrames.id))
		.where(eq(pictureFrames.ownerUserId, ownerUserId))
		.orderBy(desc(publicUploadLinks.createdAt));
}

export async function disableUploadLinkForOwner(linkId: number, ownerUserId: string) {
	const [link] = await db
		.select({ id: publicUploadLinks.id })
		.from(publicUploadLinks)
		.innerJoin(pictureFrames, eq(publicUploadLinks.frameId, pictureFrames.id))
		.where(and(eq(publicUploadLinks.id, linkId), eq(pictureFrames.ownerUserId, ownerUserId)))
		.limit(1);

	if (!link) {
		return false;
	}

	await disableUploadLink(linkId);
	return true;
}

export async function deleteUploadLinkForOwner(linkId: number, ownerUserId: string) {
	const [link] = await db
		.select({ id: publicUploadLinks.id, disabled: publicUploadLinks.disabled })
		.from(publicUploadLinks)
		.innerJoin(pictureFrames, eq(publicUploadLinks.frameId, pictureFrames.id))
		.where(and(eq(publicUploadLinks.id, linkId), eq(pictureFrames.ownerUserId, ownerUserId)))
		.limit(1);

	if (!link || !link.disabled) {
		return false;
	}

	await deleteUploadLink(linkId);
	return true;
}
