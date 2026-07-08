import type { Actions, PageServerLoad } from './$types';
import sharp from 'sharp';
import { error, fail } from '@sveltejs/kit';
import type { color } from '$lib/dither';
import { frameFormat, type DisplayUpdateMessage } from '$lib/device-contract';
import { getDeviceChannel } from '$lib/server/device/channel';
import { storeFrameArtifacts } from '../../../realtime/frame-storage.js';
import { consumeUploadLink, getLinkForUploadCode } from '$lib/server/public-upload';
import { db } from '$lib/server/db';
import { pictureFrames, pictures } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;
const channel = getDeviceChannel();

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
		const txt = await dither(bytes);
		const frame = encodeFrameArtifact(txt, frameFormat.width, frameFormat.height);
		const normalizedRequestId = requestId.replace('.', '');

		const stored = await storeFrameArtifacts(
			frameBucket,
			normalizedRequestId,
			Buffer.from(txt),
			frame
		);
		console.log('stored local frame', stored.artifactKey);

		const uploaderName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : 'Gast';
		await db.insert(pictures).values({
			frameId,
			uploaderName,
			fileName: stored.artifactKey,
			favorite: false,
			skipped: false,
			createdAt: new Date()
		});

		if (uploadLinkId) {
			await consumeUploadLink(uploadLinkId);
		}

		const updateMessage: DisplayUpdateMessage = {
			type: 'display',
			requestId: normalizedRequestId,
			createdAt: new Date().toISOString(),
			artifactKey: stored.artifactKey
		};

		channel.publishDisplay(frameId, updateMessage);

		console.log('pushed update to websocket bus');
	}
};

async function dither(input: Uint8Array) {
	const inputRaw = await sharp(input)
		.ensureAlpha()
		.resize(800, 480, {
			fit: sharp.fit.outside
		})
		.raw()
		.toBuffer();

	const palette = [
		[0, 0, 0],
		[255, 255, 255],
		[0, 255, 0],
		[0, 0, 255],
		[255, 0, 0],
		[255, 255, 0],
		[255, 128, 0]
	] as color[];

	return atkinsonDither(inputRaw, palette, 800, 480);
}

function atkinsonDither(uint8data: Uint8Array, palette: color[], w: number, h: number) {
	const data = new Uint8ClampedArray(uint8data);
	const out = new Uint8ClampedArray(w * h);

	const byteIdx = function (x: number, y: number) {
		return 4 * x + 4 * y * w;
	};

	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const pix = byteIdx(x, y);

			const original: color = [data[pix], data[pix + 1], data[pix + 2]];
			const idx = approximateColor(original, palette);
			set(out, x + y * w, idx);
		}
	}
	return out;
}

function set(buffer: Uint8ClampedArray, address: number, value: number) {
	if (address < 0 || address > buffer.length) {
		return;
	}
	buffer[address] = value;
}

function approximateColor(color: color, palette: color[]) {
	let idx = 0;
	let minDist = Infinity;
	palette.forEach((paletteColor, i) => {
		const dist = colorDistance(paletteColor, color);
		if (dist < minDist) {
			idx = i;
			minDist = dist;
		}
	});

	return idx;
}

function colorDistance(a: color, b: color) {
	return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2));
}

function encodeFrameArtifact(indexedFrame: Uint8ClampedArray, width: number, height: number) {
	const header = Buffer.from([
		frameFormat.magic.charCodeAt(0),
		frameFormat.magic.charCodeAt(1),
		frameFormat.magic.charCodeAt(2),
		frameFormat.magic.charCodeAt(3),
		width & 0xff,
		(width >> 8) & 0xff,
		height & 0xff,
		(height >> 8) & 0xff
	]);
	return Buffer.concat([header, Buffer.from(indexedFrame)]);
}
