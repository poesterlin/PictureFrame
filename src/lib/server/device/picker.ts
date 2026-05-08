import { db } from '$lib/server/db';
import { pictures } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

const FAVORITE_WEIGHT = 3;

type Candidate = {
	pictureId: number;
	artifactKey: string;
	weight: number;
};

type PickOptions = {
	excludeArtifactKey?: string;
};

export async function pickRandomPictureForFrame(
	frameId: number,
	options: PickOptions = {}
): Promise<{ pictureId: number; artifactKey: string } | null> {
	const rows = await db
		.select({
			pictureId: pictures.id,
			artifactKey: pictures.fileName,
			favorite: pictures.favorite
		})
		.from(pictures)
		.where(and(eq(pictures.frameId, frameId), eq(pictures.skipped, false)));

	if (rows.length === 0) {
		return null;
	}

	const allCandidates: Candidate[] = rows.map((row) => ({
		pictureId: row.pictureId,
		artifactKey: row.artifactKey,
		weight: row.favorite ? FAVORITE_WEIGHT : 1
	}));

	const filteredCandidates = options.excludeArtifactKey
		? allCandidates.filter((candidate) => candidate.artifactKey !== options.excludeArtifactKey)
		: allCandidates;

	const candidates = filteredCandidates.length > 0 ? filteredCandidates : allCandidates;

	const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
	let cursor = Math.random() * totalWeight;

	for (const candidate of candidates) {
		cursor -= candidate.weight;
		if (cursor <= 0) {
			return {
				pictureId: candidate.pictureId,
				artifactKey: candidate.artifactKey
			};
		}
	}

	const fallback = candidates[candidates.length - 1];
	return {
		pictureId: fallback.pictureId,
		artifactKey: fallback.artifactKey
	};
}
