import type { DisplayUpdateMessage } from '$lib/device-contract';
import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getDeviceChannel } from './channel';

const channel = getDeviceChannel();

type PublishPictureInput = {
	frameId: number;
	pictureId: number;
	artifactKey: string;
	requestId?: string;
};

export async function publishPicture(input: PublishPictureInput): Promise<DisplayUpdateMessage> {
	const createdAt = new Date();
	const message: DisplayUpdateMessage = {
		type: 'display',
		requestId: input.requestId ?? crypto.randomUUID(),
		createdAt: createdAt.toISOString(),
		artifactKey: input.artifactKey
	};

	await db
		.update(pictureFrames)
		.set({ currentPictureId: input.pictureId, lastDisplayedAt: createdAt })
		.where(eq(pictureFrames.id, input.frameId));

	channel.publishDisplay(input.frameId, message);
	return message;
}
