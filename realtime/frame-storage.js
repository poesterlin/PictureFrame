import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_FRAMES_DIR = path.join(process.cwd(), 'data', 'frames');
const PF7A_MAGIC = Buffer.from('PF7A');
const PF7C_MAGIC = Buffer.from('PF7C');
const FRAME_WIDTH = 800;
const FRAME_HEIGHT = 480;
const FRAME_PIXEL_COUNT = FRAME_WIDTH * FRAME_HEIGHT;
const FRAME_PACKED_PIXEL_BYTES = FRAME_PIXEL_COUNT / 2;
const PF7A_HEADER_SIZE = 8;

/** @param {string | undefined | null} input */
function safeSegment(input) {
	return (input || 'default').replace(/[^a-zA-Z0-9-_]/g, '_');
}

export function getFramesDir() {
	return process.env.FRAMES_DIR || DEFAULT_FRAMES_DIR;
}

export async function ensureFramesDir() {
	await fs.mkdir(getFramesDir(), { recursive: true });
}

/**
 * @param {string | undefined | null} name
 * @param {string} requestId
 * @param {Buffer | Uint8Array | string} textPayload
 * @param {Buffer | Uint8Array} framePayload
 */
export async function storeFrameArtifacts(name, requestId, textPayload, framePayload) {
	const owner = safeSegment(name);
	const fileId = safeSegment(requestId);
	const baseDir = path.join(getFramesDir(), owner);
	await fs.mkdir(baseDir, { recursive: true });

	const txtRelative = path.posix.join('frames', owner, `${fileId}.txt`);
	const pf7aRelative = path.posix.join('frames', owner, `${fileId}.pf7a`);
	const txtAbsolute = path.join(getFramesDir(), owner, `${fileId}.txt`);
	const pf7aAbsolute = path.join(getFramesDir(), owner, `${fileId}.pf7a`);

	const normalizedFramePayload = normalizeFrameArtifactPayload(Buffer.from(framePayload));
	if (!normalizedFramePayload) {
		throw new Error('invalid frame payload');
	}

	await fs.writeFile(txtAbsolute, textPayload);
	await fs.writeFile(pf7aAbsolute, normalizedFramePayload);

	return {
		legacyKey: txtRelative,
		artifactKey: pf7aRelative
	};
}

/** @param {Buffer} payload */
function hasPf7aHeader(payload) {
	return payload.length >= PF7A_HEADER_SIZE && (payload.subarray(0, 4).equals(PF7A_MAGIC) || payload.subarray(0, 4).equals(PF7C_MAGIC));
}

/** @param {Buffer} payload */
function hasValidDimensions(payload) {
	if (!hasPf7aHeader(payload)) {
		return false;
	}
	const width = payload[4] | (payload[5] << 8);
	const height = payload[6] | (payload[7] << 8);
	return width === FRAME_WIDTH && height === FRAME_HEIGHT;
}

/** @param {Buffer} payload */
function isRawPf7a(payload) {
	return payload.length >= PF7A_HEADER_SIZE
		&& payload.subarray(0, 4).equals(PF7A_MAGIC)
		&& hasValidDimensions(payload)
		&& payload.length === PF7A_HEADER_SIZE + FRAME_PIXEL_COUNT;
}

/** @param {Buffer} payload */
function isPackedPf7a(payload) {
	return payload.length >= PF7A_HEADER_SIZE
		&& payload.subarray(0, 4).equals(PF7A_MAGIC)
		&& hasValidDimensions(payload)
		&& payload.length === PF7A_HEADER_SIZE + FRAME_PACKED_PIXEL_BYTES;
}

/** @param {Buffer} pixels */
function encodePf7a(pixels) {
	const header = Buffer.from([
		PF7A_MAGIC[0],
		PF7A_MAGIC[1],
		PF7A_MAGIC[2],
		PF7A_MAGIC[3],
		FRAME_WIDTH & 0xff,
		(FRAME_WIDTH >> 8) & 0xff,
		FRAME_HEIGHT & 0xff,
		(FRAME_HEIGHT >> 8) & 0xff
	]);
	return Buffer.concat([header, pixels]);
}

/** @param {Buffer} payload */
function isLegacyIndexedFrame(payload) {
	return payload.length === FRAME_PIXEL_COUNT && payload.every((value) => value < 16);
}

/** @param {Buffer} payload */
function isLegacyPackedIndexedFrame(payload) {
	return payload.length === FRAME_PACKED_PIXEL_BYTES;
}

/** @param {Buffer} payload */
function decodePackedNibbles(payload) {
	const out = Buffer.alloc(payload.length * 2);
	let outPos = 0;
	for (let i = 0; i < payload.length; i++) {
		const byte = payload[i];
		const hi = (byte >> 4) & 0x0f;
		const lo = byte & 0x0f;
		if (hi >= 16 || lo >= 16) {
			return null;
		}
		out[outPos++] = hi;
		out[outPos++] = lo;
	}
	return out;
}

/** @param {Buffer} payload */
function encodePf7c(payload) {
	const header = Buffer.from([
		PF7C_MAGIC[0],
		PF7C_MAGIC[1],
		PF7C_MAGIC[2],
		PF7C_MAGIC[3],
		FRAME_WIDTH & 0xff,
		(FRAME_WIDTH >> 8) & 0xff,
		FRAME_HEIGHT & 0xff,
		(FRAME_HEIGHT >> 8) & 0xff
	]);
	const body = [];
	let i = 0;
	while (i < payload.length) {
		let repeatRun = 1;
		while (i + repeatRun < payload.length && payload[i + repeatRun] === payload[i] && repeatRun < 128) {
			repeatRun++;
		}
		if (repeatRun >= 3) {
			body.push(127 + repeatRun);
			body.push(payload[i]);
			i += repeatRun;
			continue;
		}

		const literalStart = i;
		i += repeatRun;
		while (i < payload.length) {
			let lookahead = 1;
			while (i + lookahead < payload.length && payload[i + lookahead] === payload[i] && lookahead < 128) {
				lookahead++;
			}
			if (lookahead >= 3 || (i - literalStart) >= 128) {
				break;
			}
			i += lookahead;
		}
		const literalLen = i - literalStart;
		body.push(literalLen - 1);
		for (let j = 0; j < literalLen; j++) {
			body.push(payload[literalStart + j]);
		}
	}

	return Buffer.concat([header, Buffer.from(body)]);
}

/** @param {number} value */
function normalizePaletteIndex(value) {
	if (value < 16) {
		return value;
	}
	const hi = (value >> 4) & 0x0f;
	const lo = value & 0x0f;
	if (hi === lo) {
		return hi;
	}
	if (hi === 0) {
		return lo;
	}
	if (lo === 0) {
		return hi;
	}
	return lo;
}

/**
 * @param {Buffer} encoded
 * @param {number} expectedOutLen
 * @param {(value: number) => number} normalize
 * @param {'rle-high' | 'packbits'} strategy
 * @returns {Buffer | null}
 */
function decodePf7cBody(encoded, expectedOutLen, normalize, strategy) {
	const out = Buffer.alloc(expectedOutLen);
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
			return null;
		}

		if (isRepeat) {
			if (inPos >= encoded.length) {
				return null;
			}
			const value = normalize(encoded[inPos++]);
			if (outPos + runLen > expectedOutLen) {
				return null;
			}
			out.fill(value, outPos, outPos + runLen);
			outPos += runLen;
			continue;
		}
		if (inPos + runLen > encoded.length || outPos + runLen > expectedOutLen) {
			return null;
		}
		for (let i = 0; i < runLen; i++) {
			out[outPos + i] = normalize(encoded[inPos + i]);
		}
		inPos += runLen;
		outPos += runLen;
	}
	return outPos === expectedOutLen ? out : null;
}

/**
 * @param {Buffer} encoded
 * @param {number} expectedOutLen
 * @param {(value: number) => number} normalize
 * @param {'rle-high' | 'packbits'} strategy
 * @returns {{ out: Buffer, delta: number } | null}
 */
function decodePf7cBodyLenient(encoded, expectedOutLen, normalize, strategy) {
	const out = Buffer.alloc(expectedOutLen);
	let inPos = 0;
	let outPos = 0;
	let lastValue = 0;

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
			return null;
		}

		if (isRepeat) {
			if (inPos >= encoded.length) {
				return null;
			}
			const value = normalize(encoded[inPos++]);
			lastValue = value;
			const writable = Math.max(0, Math.min(runLen, expectedOutLen - outPos));
			if (writable > 0) {
				out.fill(value, outPos, outPos + writable);
				outPos += writable;
			}
			continue;
		}

		if (inPos + runLen > encoded.length) {
			return null;
		}

		for (let i = 0; i < runLen; i++) {
			const value = normalize(encoded[inPos + i]);
			lastValue = value;
			if (outPos < expectedOutLen) {
				out[outPos++] = value;
			}
		}
		inPos += runLen;
	}

	if (outPos < expectedOutLen) {
		out.fill(lastValue, outPos, expectedOutLen);
	}

	return { out, delta: outPos - expectedOutLen };
}

/**
 * @param {Buffer} encoded
 * @param {number} expectedOutLen
 * @param {(value: number) => number} normalize
 * @returns {Buffer | null}
 */
function decodePf7cAnyStrategy(encoded, expectedOutLen, normalize) {
	const strategies = ['rle-high', 'packbits'];
	for (const strategy of strategies) {
		const out = decodePf7cBody(encoded, expectedOutLen, normalize, /** @type {'rle-high'|'packbits'} */ (strategy));
		if (out) {
			return out;
		}
	}
	return null;
}

/**
 * @param {Buffer} encoded
 * @param {number} expectedOutLen
 * @param {(value: number) => number} normalize
 * @returns {Buffer | null}
 */
function decodePf7cAnyStrategyLenient(encoded, expectedOutLen, normalize) {
	const strategies = ['rle-high', 'packbits'];
	/** @type {{ out: Buffer, delta: number } | null} */
	let best = null;

	for (const strategy of strategies) {
		const candidate = decodePf7cBodyLenient(
			encoded,
			expectedOutLen,
			normalize,
			/** @type {'rle-high'|'packbits'} */ (strategy)
		);
		if (!candidate) {
			continue;
		}
		if (!best || Math.abs(candidate.delta) < Math.abs(best.delta)) {
			best = candidate;
		}
	}

	if (!best) {
		return null;
	}

	return Math.abs(best.delta) <= 6000 ? best.out : null;
}

/** @param {Buffer} payload */
export function decodeFrameArtifactPayload(payload) {
	if (!hasValidDimensions(payload)) {
		return null;
	}
	if (isRawPf7a(payload)) {
		return payload.subarray(PF7A_HEADER_SIZE);
	}
	if (isPackedPf7a(payload)) {
		const packed = payload.subarray(PF7A_HEADER_SIZE);
		return decodePackedNibbles(packed);
	}
	if (!payload.subarray(0, 4).equals(PF7C_MAGIC)) {
		return null;
	}

	const encoded = payload.subarray(PF7A_HEADER_SIZE);
	const indexedPixels = decodePf7cAnyStrategy(encoded, FRAME_PIXEL_COUNT, normalizePaletteIndex);
	if (indexedPixels) {
		return indexedPixels;
	}

	const packedPixels = decodePf7cAnyStrategy(encoded, FRAME_PACKED_PIXEL_BYTES, (value) => value);
	if (packedPixels) {
		return decodePackedNibbles(packedPixels);
	}

	const indexedPixelsLenient = decodePf7cAnyStrategyLenient(encoded, FRAME_PIXEL_COUNT, normalizePaletteIndex);
	if (indexedPixelsLenient) {
		return indexedPixelsLenient;
	}

	const packedPixelsLenient = decodePf7cAnyStrategyLenient(
		encoded,
		FRAME_PACKED_PIXEL_BYTES,
		(value) => value
	);
	if (packedPixelsLenient) {
		return decodePackedNibbles(packedPixelsLenient);
	}

	return null;
}

/**
 * @param {Buffer} payload
 * @returns {Buffer | null}
 */
export function normalizeFrameArtifactPayload(payload) {
	const decoded = decodeFrameArtifactPayload(payload);
	if (decoded) {
		return encodePf7c(decoded);
	}
	if (isLegacyIndexedFrame(payload)) {
		return encodePf7c(payload);
	}
	if (isLegacyPackedIndexedFrame(payload)) {
		const decoded = decodePackedNibbles(payload);
		if (!decoded) {
			return null;
		}
		return encodePf7c(decoded);
	}
	return null;
}

/** @param {string} filePath */
function toLatestArtifactPath(filePath) {
	const lower = filePath.toLowerCase();
	if (lower.endsWith('.txt') || lower.endsWith('.pf7c')) {
		return filePath.replace(/\.[^./]+$/i, '.pf7a');
	}
	return filePath;
}

/**
 * @param {string} filePath
 * @returns {Promise<Buffer | null>}
 */
export async function ensureFrameArtifactFile(filePath) {
	const payload = await fs.readFile(filePath);
	const normalized = normalizeFrameArtifactPayload(payload);
	if (!normalized) {
		return null;
	}
	const targetPath = toLatestArtifactPath(filePath);
	const shouldWrite = normalized !== payload || targetPath !== filePath;
	if (shouldWrite) {
		await fs.writeFile(targetPath, normalized);
		if (targetPath !== filePath) {
			await fs.rm(filePath, { force: true });
		}
	}
	return normalized;
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function walk(dir) {
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

export async function listArtifactKeys() {
	await ensureFramesDir();
	const files = await walk(getFramesDir());
	const preferredByBase = new Map();
	for (const filePath of files) {
		const lower = filePath.toLowerCase();
		let rank = 0;
		if (lower.endsWith('.txt')) rank = 1;
		if (lower.endsWith('.pf7c')) rank = 2;
		if (lower.endsWith('.pf7a')) rank = 3;
		if (rank === 0) continue;

		const base = filePath.slice(0, filePath.lastIndexOf('.'));
		const current = preferredByBase.get(base);
		if (!current || rank > current.rank) {
			preferredByBase.set(base, { filePath, rank });
		}
	}
	const artifactFiles = Array.from(preferredByBase.values()).map((entry) => entry.filePath);
	/** @type {string[]} */
	const validFiles = [];
	const seen = new Set();
	for (const filePath of artifactFiles) {
		try {
			if (await ensureFrameArtifactFile(filePath)) {
				const latestPath = toLatestArtifactPath(filePath);
				if (!seen.has(latestPath)) {
					seen.add(latestPath);
					validFiles.push(latestPath);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : error;
			console.warn('skipping invalid frame artifact', filePath, message);
		}
	}
	return validFiles.map((filePath) => {
		const rel = path.relative(getFramesDir(), filePath).split(path.sep).join('/');
		return `frames/${rel}`;
	});
}

export async function pickRandomArtifactKey() {
	const keys = await listArtifactKeys();
	if (keys.length === 0) {
		return null;
	}
	return keys[Math.floor(Math.random() * keys.length)];
}

/** @param {string} requestPathname */
export function resolveFrameAbsolutePath(requestPathname) {
	const normalized = requestPathname.startsWith('/') ? requestPathname.slice(1) : requestPathname;
	if (!normalized.startsWith('frames/')) {
		return null;
	}
	const relative = normalized.slice('frames/'.length);
	const full = path.resolve(getFramesDir(), relative);
	const root = path.resolve(getFramesDir());
	if (!full.startsWith(root)) {
		return null;
	}
	return full;
}

/** @param {string} key */
export async function deleteFrameByKey(key) {
	const full = resolveFrameAbsolutePath(key);
	if (!full) {
		return false;
	}
	await fs.rm(full, { force: true });
	return true;
}
