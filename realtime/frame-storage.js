import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_FRAMES_DIR = path.join(process.cwd(), 'data', 'frames');
const PF7A_MAGIC = Buffer.from('PF7A');
const FRAME_WIDTH = 800;
const FRAME_HEIGHT = 480;
const FRAME_PIXEL_COUNT = FRAME_WIDTH * FRAME_HEIGHT;
const PF7A_HEADER_SIZE = 8;

function safeSegment(input) {
	return (input || 'default').replace(/[^a-zA-Z0-9-_]/g, '_');
}

export function getFramesDir() {
	return process.env.FRAMES_DIR || DEFAULT_FRAMES_DIR;
}

export async function ensureFramesDir() {
	await fs.mkdir(getFramesDir(), { recursive: true });
}

export async function storeFrameArtifacts(name, requestId, textPayload, framePayload) {
	const owner = safeSegment(name);
	const fileId = safeSegment(requestId);
	const baseDir = path.join(getFramesDir(), owner);
	await fs.mkdir(baseDir, { recursive: true });

	const txtRelative = path.posix.join('frames', owner, `${fileId}.txt`);
	const pf7aRelative = path.posix.join('frames', owner, `${fileId}.pf7a`);
	const txtAbsolute = path.join(getFramesDir(), owner, `${fileId}.txt`);
	const pf7aAbsolute = path.join(getFramesDir(), owner, `${fileId}.pf7a`);

	await fs.writeFile(txtAbsolute, textPayload);
	await fs.writeFile(pf7aAbsolute, framePayload);

	return {
		legacyKey: txtRelative,
		artifactKey: pf7aRelative
	};
}

function hasPf7aHeader(payload) {
	return payload.length >= PF7A_HEADER_SIZE && payload.subarray(0, 4).equals(PF7A_MAGIC);
}

function isValidPf7a(payload) {
	if (!hasPf7aHeader(payload)) {
		return false;
	}
	const width = payload[4] | (payload[5] << 8);
	const height = payload[6] | (payload[7] << 8);
	return width === FRAME_WIDTH && height === FRAME_HEIGHT && payload.length === PF7A_HEADER_SIZE + FRAME_PIXEL_COUNT;
}

function isLegacyIndexedFrame(payload) {
	return payload.length === FRAME_PIXEL_COUNT && payload.every((value) => value < 7);
}

function encodePf7a(payload) {
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
	return Buffer.concat([header, payload]);
}

export function normalizeFrameArtifactPayload(payload) {
	if (isValidPf7a(payload)) {
		return payload;
	}
	if (isLegacyIndexedFrame(payload)) {
		return encodePf7a(payload);
	}
	return null;
}

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
	const validFiles = [];
	for (const filePath of artifactFiles) {
		try {
			if (await ensureFrameArtifactFile(filePath)) {
				validFiles.push(filePath);
			}
		} catch (error) {
			console.warn('skipping invalid frame artifact', filePath, error?.message ?? error);
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

export async function deleteFrameByKey(key) {
	const full = resolveFrameAbsolutePath(key);
	if (!full) {
		return false;
	}
	await fs.rm(full, { force: true });
	return true;
}
