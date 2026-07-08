import { db } from '$lib/server/db';
import { pictureFrames } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getDeviceChannel } from './channel';
import { pickRandomPictureForFrame } from './picker';

const channel = getDeviceChannel();

type RotationOutcome = { rotated: true; artifactKey: string } | { rotated: false; reason: string };

/**
 * Decides whether the given frame should advance to a new picture and, if so,
 * publishes a fresh display event. The rotation cadence is driven by the
 * server-side `refreshEverySeconds` and `autoRotate` settings, not the device.
 */
export async function maybeRotate(frameId: number): Promise<RotationOutcome> {
	const [frame] = await db
		.select({
			refreshEverySeconds: pictureFrames.refreshEverySeconds,
			autoRotate: pictureFrames.autoRotate
		})
		.from(pictureFrames)
		.where(eq(pictureFrames.id, frameId))
		.limit(1);

	if (!frame) {
		return { rotated: false, reason: 'frame-not-found' };
	}

	if (!frame.autoRotate) {
		return { rotated: false, reason: 'auto-rotate-disabled' };
	}

	const snapshot = channel.getSnapshot(frameId);
	const lastDisplayedAt = channel.getLastDisplayedAt(frameId);
	const intervalMs = frame.refreshEverySeconds * 1000;

	// First display ever: rotate immediately so the frame has something to show.
	if (snapshot.display && lastDisplayedAt !== null) {
		const elapsed = Date.now() - lastDisplayedAt;
		if (elapsed < intervalMs) {
			return { rotated: false, reason: 'interval-not-elapsed' };
		}
	}

	const picked = await pickRandomPictureForFrame(frameId, {
		excludeArtifactKey: snapshot.display?.artifactKey
	});
	if (!picked) {
		return { rotated: false, reason: 'no-pictures' };
	}

	channel.publishDisplay(frameId, {
		type: 'display',
		requestId: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		artifactKey: picked.artifactKey
	});

	return { rotated: true, artifactKey: picked.artifactKey };
}
