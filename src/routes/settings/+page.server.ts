import type { DeviceCommandMessage } from '$lib/device-contract';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import {
	createPublicUploadLink,
	deleteUploadLinkForOwner,
	disableUploadLinkForOwner,
	listPublicUploadLinksByOwner
} from '$lib/server/public-upload';
import { getDeviceChannel } from '$lib/server/device/channel';

export const prerender = false;
const channel = getDeviceChannel();

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login?redirect=%2Fsettings');
	}

	const [frame] = await db
		.select({
			id: pictureFrames.id,
			frameName: pictureFrames.frameName,
			refreshEverySeconds: pictureFrames.refreshEverySeconds
		})
		.from(pictureFrames)
		.where(eq(pictureFrames.ownerUserId, locals.user.id))
		.limit(1);

	const links = await listPublicUploadLinksByOwner(locals.user.id);

	return {
		frame: frame ?? null,
		links
	};
};

export const actions: Actions = {
	saveSettings: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const form = await request.formData();
		const refreshEveryRaw = Number(form.get('refreshEvery'));
		if (!Number.isFinite(refreshEveryRaw)) {
			return fail(400, { message: 'Invalid refresh interval' });
		}

		const refreshEvery = Math.max(30, Math.min(6 * 60 * 60, Math.floor(refreshEveryRaw)));

		const [ownedFrame] = await db
			.select({ id: pictureFrames.id })
			.from(pictureFrames)
			.where(eq(pictureFrames.ownerUserId, locals.user.id))
			.limit(1);

		if (!ownedFrame) {
			return fail(400, { message: 'No frame linked to your account' });
		}

		await db
			.update(pictureFrames)
			.set({ refreshEverySeconds: refreshEvery, updatedAt: new Date() })
			.where(eq(pictureFrames.id, ownedFrame.id));

		return { settingsSaved: true };
	},

	createUploadLink: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const form = await request.formData();
		const frameId = Number(form.get('frameId'));

		if (!Number.isFinite(frameId) || frameId <= 0) {
			return fail(400, { message: 'Invalid frame id' });
		}

		const [ownedFrame] = await db
			.select({ id: pictureFrames.id })
			.from(pictureFrames)
			.where(and(eq(pictureFrames.id, frameId), eq(pictureFrames.ownerUserId, locals.user.id)))
			.limit(1);

		if (!ownedFrame) {
			return fail(403, { message: 'Frame not owned by user' });
		}

		const created = await createPublicUploadLink(frameId);

		return {
			success: true,
			created,
			uploadUrl: `/upload?code=${encodeURIComponent(created.code)}`
		};
	},

	disableUploadLink: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const form = await request.formData();
		const linkId = Number(form.get('linkId'));

		if (!Number.isFinite(linkId) || linkId <= 0) {
			return fail(400, { message: 'Invalid link id' });
		}

		const disabled = await disableUploadLinkForOwner(linkId, locals.user.id);
		if (!disabled) {
			return fail(404, { message: 'Upload link not found' });
		}

		return { success: true };
	},

	deleteUploadLink: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const form = await request.formData();
		const linkId = Number(form.get('linkId'));

		if (!Number.isFinite(linkId) || linkId <= 0) {
			return fail(400, { message: 'Invalid link id' });
		}

		const deleted = await deleteUploadLinkForOwner(linkId, locals.user.id);
		if (!deleted) {
			return fail(404, { message: 'Upload link not found or not deactivated' });
		}

		return { success: true };
	}
};
