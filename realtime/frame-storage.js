import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_FRAMES_DIR = path.join(process.cwd(), 'data', 'frames');

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
	return files
		.filter((filePath) => filePath.toLowerCase().endsWith('.pf7a'))
		.map((filePath) => {
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
