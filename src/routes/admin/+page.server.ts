import { isAdminUser } from '$lib/server/admin';
import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import { generateFrameToken } from '$lib/server/frame-auth';
import { UNCLAIMED_FRAME_REFRESH_SECONDS } from '$lib/server/frame-defaults';
import {
	createFrameClaimCodeForOwner,
	deleteDisabledFrameClaimCodeForOwner,
	disableFrameClaimCodeForOwner,
	listFrameClaimCodesByOwner
} from '$lib/server/frame-claim';
import { createPublicUploadLink } from '$lib/server/public-upload';
import { fail, redirect } from '@sveltejs/kit';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login?redirect=%2Fadmin');
	}

	if (!isAdminUser(locals.user)) {
		throw redirect(302, '/');
	}

	const frames = await db
		.select({ id: pictureFrames.id, frameName: pictureFrames.frameName, claimed: isNotNull(pictureFrames.ownerUserId) })
		.from(pictureFrames);

	const claimCodes = await listFrameClaimCodesByOwner();

	return {
		frames,
		claimCodes
	};
};

export const actions: Actions = {
	createGiftFrame: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		if (!isAdminUser(locals.user)) {
			return fail(403, { message: 'Forbidden' });
		}

		const form = await request.formData();
		const frameName = String(form.get('frameName') || '').trim();

		if (frameName.length < 2 || frameName.length > 80) {
			return fail(400, { message: 'Frame name must be between 2 and 80 characters' });
		}


		const now = new Date();
		const inserted = await db
			.insert(pictureFrames)
			.values({
				frameName,
				authKey: generateFrameToken(),
				currentPictureId: null,
				refreshEverySeconds: UNCLAIMED_FRAME_REFRESH_SECONDS,
				autoRotate: true,
				showFavoritesOnly: false,
				disabled: false,
				createdAt: now,
				updatedAt: now
			})
			.returning({ id: pictureFrames.id, frameName: pictureFrames.frameName });

		return {
			success: true,
			createdFrame: inserted[0]
		};
	},

	createClaimCode: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		if (!isAdminUser(locals.user)) {
			return fail(403, { message: 'Forbidden' });
		}

		const form = await request.formData();
		const frameId = Number(form.get('frameId'));
		const ttlHours = Number(form.get('ttlHours') || 24 * 14);

		if (!Number.isFinite(frameId) || frameId <= 0) {
			return fail(400, { message: 'Invalid frame id' });
		}

		const created = await createFrameClaimCodeForOwner(frameId, { ttlHours });
		if (!created) {
			return fail(404, { message: 'Unclaimed frame not found' });
		}

		return {
			success: true,
			claimCode: created.code
		};
	},

	createUploadCode: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		if (!isAdminUser(locals.user)) {
			return fail(403, { message: 'Forbidden' });
		}

		const form = await request.formData();
		const frameId = Number(form.get('frameId'));

		if (!Number.isFinite(frameId) || frameId <= 0) {
			return fail(400, { message: 'Invalid frame id' });
		}

		const [frame] = await db
			.select({ id: pictureFrames.id })
			.from(pictureFrames)
			.where(eq(pictureFrames.id, frameId))
			.limit(1);

		if (!frame) {
			return fail(404, { message: 'Unclaimed frame not found' });
		}

		const created = await createPublicUploadLink(frameId);

		return {
			success: true,
			uploadCode: created.code,
			uploadUrl: `/upload?code=${encodeURIComponent(created.code)}`
		};
	},

	deleteFrame: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		if (!isAdminUser(locals.user)) {
			return fail(403, { message: 'Forbidden' });
		}

		const form = await request.formData();
		const frameId = Number(form.get('frameId'));

		if (!Number.isFinite(frameId) || frameId <= 0) {
			return fail(400, { message: 'Invalid frame id' });
		}

		const deleted = await db
			.delete(pictureFrames)
			.where(and(eq(pictureFrames.id, frameId), isNull(pictureFrames.ownerUserId)))
			.returning({ id: pictureFrames.id });

		if (deleted.length === 0) {
			return fail(404, { message: 'Unclaimed frame not found' });
		}

		return { success: true };
	},

	disableClaimCode: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		if (!isAdminUser(locals.user)) {
			return fail(403, { message: 'Forbidden' });
		}

		const form = await request.formData();
		const codeId = Number(form.get('codeId'));

		if (!Number.isFinite(codeId) || codeId <= 0) {
			return fail(400, { message: 'Invalid code id' });
		}

		const disabled = await disableFrameClaimCodeForOwner(codeId);
		if (!disabled) {
			return fail(404, { message: 'Claim code not found' });
		}

		return { success: true };
	},

	deleteClaimCode: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		if (!isAdminUser(locals.user)) {
			return fail(403, { message: 'Forbidden' });
		}

		const form = await request.formData();
		const codeId = Number(form.get('codeId'));

		if (!Number.isFinite(codeId) || codeId <= 0) {
			return fail(400, { message: 'Invalid code id' });
		}

		const deleted = await deleteDisabledFrameClaimCodeForOwner(codeId);
		if (!deleted) {
			return fail(404, { message: 'Disabled claim code not found' });
		}

		return { success: true };
	}
};
