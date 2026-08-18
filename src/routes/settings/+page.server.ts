import type { DeviceCommandMessage } from '$lib/device-contract';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { pictureFrames, publicUploadLinks } from '$lib/server/db/schema';
import {
	activeFrameIdFrom,
	canAccessFrame,
	resolveAccessibleFrame,
	setActiveFrameCookie
} from '$lib/server/frame-access';
import {
	createPublicUploadLink,
	deleteUploadLink,
	disableUploadLink
} from '$lib/server/public-upload';
import { getDeviceChannel } from '$lib/server/device/channel';

export const prerender = false;
const channel = getDeviceChannel();

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user) {
		throw redirect(302, '/login?redirect=%2Fsettings');
	}

	const requestedFrameId = activeFrameIdFrom(
		cookies,
		Number(url.searchParams.get('frameId')) || null
	);
	const { frame, frames, isAdmin } = await resolveAccessibleFrame(locals.user, requestedFrameId);
	if (isAdmin && frame) setActiveFrameCookie(cookies, frame.id, url.protocol === 'https:');
	const links = frame
		? await db
				.select({
					id: publicUploadLinks.id,
					frameId: publicUploadLinks.frameId,
					uploadCount: publicUploadLinks.uploadCount,
					disabled: publicUploadLinks.disabled,
					frameName: pictureFrames.frameName
				})
				.from(publicUploadLinks)
				.innerJoin(pictureFrames, eq(publicUploadLinks.frameId, pictureFrames.id))
				.where(eq(publicUploadLinks.frameId, frame.id))
		: [];

	return {
		frame,
		frames,
		isAdmin,
		links
	};
};

export const actions: Actions = {
	saveSettings: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const form = await request.formData();
		const selectedFrame = await canAccessFrame(locals.user, Number(form.get('frameId')));
		if (!selectedFrame) return fail(403, { message: 'Frame not available' });
		const refreshEveryRaw = Number(form.get('refreshEvery'));
		if (!Number.isFinite(refreshEveryRaw)) {
			return fail(400, { message: 'Invalid refresh interval' });
		}

		const refreshEvery = Math.max(30, Math.min(6 * 60 * 60, Math.floor(refreshEveryRaw)));

		await db
			.update(pictureFrames)
			.set({ refreshEverySeconds: refreshEvery, updatedAt: new Date() })
			.where(eq(pictureFrames.id, selectedFrame.id));

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

		const selectedFrame = await canAccessFrame(locals.user, frameId);
		if (!selectedFrame) return fail(403, { message: 'Frame not available' });

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
		const frameId = Number(form.get('frameId'));

		if (!Number.isFinite(linkId) || linkId <= 0) {
			return fail(400, { message: 'Invalid link id' });
		}

		const selectedFrame = await canAccessFrame(locals.user, frameId);
		if (!selectedFrame) return fail(403, { message: 'Frame not available' });
		const [link] = await db
			.select({ id: publicUploadLinks.id })
			.from(publicUploadLinks)
			.where(and(eq(publicUploadLinks.id, linkId), eq(publicUploadLinks.frameId, frameId)))
			.limit(1);
		if (!link) return fail(404, { message: 'Upload link not found' });
		await disableUploadLink(linkId);

		return { success: true };
	},

	deleteUploadLink: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const form = await request.formData();
		const linkId = Number(form.get('linkId'));
		const frameId = Number(form.get('frameId'));

		if (!Number.isFinite(linkId) || linkId <= 0) {
			return fail(400, { message: 'Invalid link id' });
		}

		const selectedFrame = await canAccessFrame(locals.user, frameId);
		if (!selectedFrame) return fail(403, { message: 'Frame not available' });
		const [link] = await db
			.select({ id: publicUploadLinks.id })
			.from(publicUploadLinks)
			.where(
				and(
					eq(publicUploadLinks.id, linkId),
					eq(publicUploadLinks.frameId, frameId),
					eq(publicUploadLinks.disabled, true)
				)
			)
			.limit(1);
		if (!link) return fail(404, { message: 'Upload link not found or not deactivated' });
		await deleteUploadLink(linkId);

		return { success: true };
	}
};
