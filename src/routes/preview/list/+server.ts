import type { RequestHandler } from '@sveltejs/kit';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	ensureFrameArtifactFile,
	ensureFramesDir,
	getFramesDir,
	listArtifactKeys
} from '../../../../realtime/frame-storage.js';

async function walk(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				return walk(fullPath);
			}
			return [fullPath];
		})
	);
	return files.flat();
}

export const GET: RequestHandler = async ({ url }) => {
	await ensureFramesDir();
	const framesDir = getFramesDir();
	const allFiles = await walk(framesDir);

	const pfFiles = allFiles.filter((filePath) => {
		const lower = filePath.toLowerCase();
		return lower.endsWith('.pf7a') || lower.endsWith('.pf7c');
	});

	let invalidArtifactCount = 0;
	for (const filePath of pfFiles) {
		try {
			const normalized = await ensureFrameArtifactFile(filePath);
			if (!normalized) {
				invalidArtifactCount += 1;
			}
		} catch {
			invalidArtifactCount += 1;
		}
	}

	const keys = await listArtifactKeys();
	const limit = Number(url.searchParams.get('limit') || 100);
	const offset = Number(url.searchParams.get('offset') || 0);
	const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.min(1000, limit)) : 100;
	const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;

	return new Response(
		JSON.stringify({
			framesDir,
			totalFiles: allFiles.length,
			totalArtifactFiles: pfFiles.length,
			validArtifactFiles: keys.length,
			invalidArtifactFiles: invalidArtifactCount,
			limit: safeLimit,
			offset: safeOffset,
			keys: keys.slice(safeOffset, safeOffset + safeLimit)
		}),
		{
			headers: { 'content-type': 'application/json; charset=utf-8' }
		}
	);
};
