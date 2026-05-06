import type { RequestHandler } from '@sveltejs/kit';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	ensureFrameArtifactFile,
	ensureFramesDir,
	getFramesDir,
	listArtifactKeys
} from '../../../../realtime/frame-storage.js';

const PIXEL_COUNT = 800 * 480;
const RAW_SIZE = PIXEL_COUNT;
const PACKED_SIZE = PIXEL_COUNT / 2;
const HEADER_SIZE = 8;

function classifyBuffer(buffer: Buffer) {
	const size = buffer.length;
	if (size === RAW_SIZE) return 'legacy_raw_no_header';
	if (size === PACKED_SIZE) return 'legacy_packed_no_header';
	if (size < HEADER_SIZE) return 'too_small';

	const magic = buffer.subarray(0, 4).toString('ascii');
	if (magic !== 'PF7A' && magic !== 'PF7C') {
		return `unknown_magic_${JSON.stringify(magic)}`;
	}

	const width = buffer[4] | (buffer[5] << 8);
	const height = buffer[6] | (buffer[7] << 8);
	if (width !== 800 || height !== 480) {
		return `bad_dimensions_${width}x${height}`;
	}

	const body = size - HEADER_SIZE;
	if (magic === 'PF7A' && body === RAW_SIZE) return 'pf7a_raw';
	if (magic === 'PF7A' && body === PACKED_SIZE) return 'pf7a_packed';
	if (magic === 'PF7C') return 'pf7c_rle';
	return `unexpected_size_${size}`;
}

function decodeProbePf7c(buffer: Buffer) {
	const encoded = buffer.subarray(HEADER_SIZE);

	function tryDecode(expectedOutLen: number, strategy: 'rle-high' | 'packbits') {
		let inPos = 0;
		let outPos = 0;
		while (inPos < encoded.length) {
			const control = encoded[inPos++];
			if (strategy === 'packbits' && control === 128) {
				continue;
			}

			const isRepeat = strategy === 'rle-high' ? control >= 128 : control > 128;
			const runLen = strategy === 'rle-high'
				? (control >= 128 ? control - 127 : control + 1)
				: (control > 128 ? 257 - control : control + 1);

			if (runLen <= 0) {
				return { ok: false, reason: 'bad_run_length', inPos, outPos, control };
			}

			if (isRepeat) {
				if (inPos >= encoded.length) {
					return { ok: false, reason: 'repeat_value_missing', inPos, outPos, control };
				}
				inPos += 1;
				if (outPos + runLen > expectedOutLen) {
					return { ok: false, reason: 'repeat_overflow', inPos, outPos, control, runLen };
				}
				outPos += runLen;
				continue;
			}

			if (inPos + runLen > encoded.length) {
				return { ok: false, reason: 'literal_input_overflow', inPos, outPos, control, runLen };
			}
			if (outPos + runLen > expectedOutLen) {
				return { ok: false, reason: 'literal_output_overflow', inPos, outPos, control, runLen };
			}

			inPos += runLen;
			outPos += runLen;
		}

		return { ok: outPos === expectedOutLen, reason: outPos === expectedOutLen ? 'ok' : 'size_mismatch', inPos, outPos };
	}

	return {
		rleHighRaw: tryDecode(RAW_SIZE, 'rle-high'),
		rleHighPacked: tryDecode(PACKED_SIZE, 'rle-high'),
		packbitsRaw: tryDecode(RAW_SIZE, 'packbits'),
		packbitsPacked: tryDecode(PACKED_SIZE, 'packbits')
	};
}

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
		return lower.endsWith('.pf7a') || lower.endsWith('.pf7c') || lower.endsWith('.txt');
	});

	const invalidReasonCounts: Record<string, number> = {};
	const invalidSamples: Array<Record<string, unknown>> = [];

	let invalidArtifactCount = 0;
	for (const filePath of pfFiles) {
		try {
			const normalized = await ensureFrameArtifactFile(filePath);
			if (!normalized) {
				invalidArtifactCount += 1;
				const payload = await fs.readFile(filePath);
				const reason = classifyBuffer(payload);
				invalidReasonCounts[reason] = (invalidReasonCounts[reason] || 0) + 1;
				if (invalidSamples.length < 10) {
					const magic = payload.length >= 4 ? payload.subarray(0, 4).toString('ascii') : '';
					const width = payload.length >= 6 ? payload[4] | (payload[5] << 8) : -1;
					const height = payload.length >= 8 ? payload[6] | (payload[7] << 8) : -1;
					const probe = reason === 'pf7c_rle' ? decodeProbePf7c(payload) : undefined;
					invalidSamples.push({
						file: path.relative(framesDir, filePath).split(path.sep).join('/'),
						reason,
						size: payload.length,
						magic,
						width,
						height,
						probe
					});
				}
			}
		} catch (error) {
			invalidArtifactCount += 1;
			const reason = `read_error_${error instanceof Error ? error.name : 'unknown'}`;
			invalidReasonCounts[reason] = (invalidReasonCounts[reason] || 0) + 1;
			if (invalidSamples.length < 10) {
				invalidSamples.push({
					file: path.relative(framesDir, filePath).split(path.sep).join('/'),
					reason,
					size: -1
				});
			}
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
			invalidReasonCounts,
			invalidSamples,
			limit: safeLimit,
			offset: safeOffset,
			keys: keys.slice(safeOffset, safeOffset + safeLimit)
		}),
		{
			headers: { 'content-type': 'application/json; charset=utf-8' }
		}
	);
};
