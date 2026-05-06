import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_FRAMES_DIR = path.join(process.cwd(), 'data', 'frames');
const PF7A_MAGIC = Buffer.from('PF7A');
const PF7C_MAGIC = Buffer.from('PF7C');
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

/** @param {Buffer} payload */
export function decodeFrameArtifactPayload(payload) {
	if (!hasValidDimensions(payload)) {
		return null;
	}
	if (isRawPf7a(payload)) {
		return payload.subarray(PF7A_HEADER_SIZE);
	}
	if (!payload.subarray(0, 4).equals(PF7C_MAGIC)) {
		return null;
	}

	const encoded = payload.subarray(PF7A_HEADER_SIZE);
	const out = Buffer.alloc(FRAME_PIXEL_COUNT);
	let inPos = 0;
	let outPos = 0;
	while (inPos < encoded.length) {
		const control = encoded[inPos++];
		const runLen = control >= 128 ? control - 127 : control + 1;
		if (control >= 128) {
			if (inPos >= encoded.length) {
				return null;
			}
			const value = encoded[inPos++];
			if (outPos + runLen > FRAME_PIXEL_COUNT || value >= 16) {
				return null;
			}
			out.fill(value, outPos, outPos + runLen);
			outPos += runLen;
			continue;
		}
		if (inPos + runLen > encoded.length || outPos + runLen > FRAME_PIXEL_COUNT) {
			return null;
		}
		for (let i = 0; i < runLen; i++) {
			const value = encoded[inPos + i];
			if (value >= 16) {
				return null;
			}
			out[outPos + i] = value;
		}
		inPos += runLen;
		outPos += runLen;
	}
	return outPos === FRAME_PIXEL_COUNT ? out : null;
}

/**
 * @param {Buffer} payload
 * @returns {Buffer | null}
 */
export function normalizeFrameArtifactPayload(payload) {
	const decoded = decodeFrameArtifactPayload(payload);
	if (decoded) {
		const compressed = encodePf7c(decoded);
		if (compressed.length <= payload.length) {
			return compressed;
		}
		return payload;
	}
	if (isLegacyIndexedFrame(payload)) {
		const raw = encodePf7a(payload);
		const compressed = encodePf7c(payload);
		return compressed.length <= raw.length ? compressed : raw;
	}
	return null;
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
	if (normalized !== payload) {
		await fs.writeFile(filePath, normalized);
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
	const artifactFiles = files.filter((filePath) => filePath.toLowerCase().endsWith('.pf7a'));
	/** @type {string[]} */
	const validFiles = [];
	for (const filePath of artifactFiles) {
		try {
			if (await ensureFrameArtifactFile(filePath)) {
				validFiles.push(filePath);
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
