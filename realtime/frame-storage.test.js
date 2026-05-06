import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureFrameArtifactFile, normalizeFrameArtifactPayload } from './frame-storage.js';

const WIDTH = 800;
const HEIGHT = 480;
const PIXELS = WIDTH * HEIGHT;
const HEADER = Buffer.from(['P'.charCodeAt(0), 'F'.charCodeAt(0), '7'.charCodeAt(0), 'A'.charCodeAt(0), 0x20, 0x03, 0xe0, 0x01]);

test('passes through valid pf7a payloads', () => {
	const pixels = Buffer.alloc(PIXELS, 1);
	const payload = Buffer.concat([HEADER, pixels]);

	assert.equal(normalizeFrameArtifactPayload(payload), payload);
});

test('converts renamed legacy indexed payloads', () => {
	const legacy = Buffer.alloc(PIXELS, 2);
	const normalized = normalizeFrameArtifactPayload(legacy);

	assert.ok(normalized);
	assert.equal(normalized.length, PIXELS + HEADER.length);
	assert.deepEqual(normalized.subarray(0, HEADER.length), HEADER);
	assert.deepEqual(normalized.subarray(HEADER.length), legacy);
});

test('rejects invalid payloads', () => {
	assert.equal(normalizeFrameArtifactPayload(Buffer.alloc(10, 1)), null);
	assert.equal(normalizeFrameArtifactPayload(Buffer.alloc(PIXELS, 9)), null);
});

test('rewrites legacy files in place', async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf7a-'));
	const filePath = path.join(dir, 'legacy.pf7a');
	await fs.writeFile(filePath, Buffer.alloc(PIXELS, 3));

	const normalized = await ensureFrameArtifactFile(filePath);
	const written = await fs.readFile(filePath);

	assert.ok(normalized);
	assert.equal(written.length, PIXELS + HEADER.length);
	assert.deepEqual(written, normalized);
});
