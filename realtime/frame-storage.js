import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_FRAMES_DIR = path.join(process.cwd(), 'data', 'frames');
const PF7A_MAGIC = Buffer.from('PF7A');
const FRAME_WIDTH = 800;
const FRAME_HEIGHT = 480;
const FRAME_PIXEL_COUNT = FRAME_WIDTH * FRAME_HEIGHT;
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

	const pf7aRelative = path.posix.join('frames', owner, `${fileId}.pf7a`);
	const pf7aAbsolute = path.join(getFramesDir(), owner, `${fileId}.pf7a`);

	const normalizedFramePayload = normalizeFrameArtifactPayload(Buffer.from(framePayload));
	if (!normalizedFramePayload) {
		throw new Error('invalid frame payload');
	}

	await fs.writeFile(pf7aAbsolute, normalizedFramePayload);

	return {
		artifactKey: pf7aRelative
	};
}

/** @param {Buffer} payload */
function hasPf7aHeader(payload) {
	return payload.length >= PF7A_HEADER_SIZE && payload.subarray(0, 4).equals(PF7A_MAGIC);
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
	return (
		payload.length >= PF7A_HEADER_SIZE &&
		payload.subarray(0, 4).equals(PF7A_MAGIC) &&
		hasValidDimensions(payload) &&
		payload.length === PF7A_HEADER_SIZE + FRAME_PIXEL_COUNT
	);
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
	return payload.length === FRAME_PIXEL_COUNT && payload.every((value) => value <= 7);
}

/** @param {Buffer} payload */
export function decodeFrameArtifactPayload(payload) {
	if (!isRawPf7a(payload)) {
		return null;
	}
	return payload.subarray(PF7A_HEADER_SIZE);
}

/**
 * @param {Buffer} payload
 * @returns {Buffer | null}
 */
export function normalizeFrameArtifactPayload(payload) {
	const decoded = decodeFrameArtifactPayload(payload);
	if (decoded) {
		return payload;
	}
	if (isLegacyIndexedFrame(payload)) {
		return encodePf7a(payload);
	}
	return null;
}

/** @param {string} filePath */
function toLatestArtifactPath(filePath) {
	const lower = filePath.toLowerCase();
	if (lower.endsWith('.txt')) {
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
	const shouldWrite = !normalized.equals(payload) || targetPath !== filePath;
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
		if (lower.endsWith('.pf7a')) rank = 2;
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
