import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { storeFrameArtifacts } from '../../../realtime/frame-storage.js';
import { consumeUploadLink, getLinkForUploadCode } from '$lib/server/public-upload';
import { db } from '$lib/server/db';
import { pictureFrames, pictures } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeImageAsFrame } from '$lib/server/frame-image';
import { publishPicture } from '$lib/server/device/display';

export const prerender = false;

export const load: PageServerLoad = async ({ url, locals }) => {
	const uploadCode = url.searchParams.get('code')?.trim();
	const canUploadWithoutCode = Boolean(locals.user);

	if (!canUploadWithoutCode && !uploadCode) {
		error(404, 'this link has expired or is invalid');
	}

	if (!canUploadWithoutCode) {
		const link = await getLinkForUploadCode(uploadCode!);
		if (!link) {
			error(403, 'Invalid or expired upload code');
		}
	}

	return {
		uploadCode: uploadCode ?? '',
		canUploadWithoutCode
	};
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const values = await request.formData();
		const uploadCode = url.searchParams.get('code')?.trim();
		const user = locals.user;

		let frameBucket = '';
		let frameId: number | null = null;
		let uploadLinkId: number | null = null;

		if (user) {
			if (uploadCode) {
				const link = await getLinkForUploadCode(uploadCode);
				if (link) {
					frameBucket = `frame-${link.frameId}`;
					frameId = link.frameId;
					uploadLinkId = link.id;
				}
			}

			if (!frameBucket) {
				const [ownedFrame] = await db
					.select({ id: pictureFrames.id })
					.from(pictureFrames)
					.where(eq(pictureFrames.ownerUserId, user.id))
					.limit(1);

				if (!ownedFrame) {
					return fail(400, { message: 'No frame linked to your account' });
				}

				frameBucket = `frame-${ownedFrame.id}`;
				frameId = ownedFrame.id;
			}
		} else {
			if (!uploadCode) {
				return fail(400, { message: 'Missing upload code' });
			}

			const link = await getLinkForUploadCode(uploadCode);
			if (!link) {
				return fail(403, { message: 'Invalid or expired upload code' });
			}

			frameBucket = `frame-${link.frameId}`;
			frameId = link.frameId;
			uploadLinkId = link.id;
		}

		if (!frameId) {
			return fail(400, { message: 'Frame not found' });
		}

		const name = values.get('name') as string;
		console.log('new image from', name);

		const requestId = (values.get('reqId') as string) || crypto.randomUUID();

		const file = values.get('image') as File;
		const bytes = await file.bytes();
		const encodedFrame = await encodeImageAsFrame(bytes);
		const normalizedRequestId = requestId.replace('.', '');

		const stored = await storeFrameArtifacts(
			frameBucket,
			normalizedRequestId,
			Buffer.from(encodedFrame.indexedPixels),
			encodedFrame.artifact
		);
		console.log('stored local frame', stored.artifactKey);

		const uploaderName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : 'Gast';
		const [createdPicture] = await db
			.insert(pictures)
			.values({
				frameId,
				uploaderName,
				fileName: stored.artifactKey,
				favorite: false,
				skipped: false,
				createdAt: new Date()
			})
			.returning({ id: pictures.id });

		if (uploadLinkId) {
			await consumeUploadLink(uploadLinkId);
		}

		await publishPicture({
			frameId,
			pictureId: createdPicture.id,
			artifactKey: stored.artifactKey,
			requestId: normalizedRequestId
		});

		console.log('pushed update to websocket bus');
	}
};
