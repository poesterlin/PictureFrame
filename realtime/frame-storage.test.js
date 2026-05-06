import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { decodeFrameArtifactPayload, ensureFrameArtifactFile, normalizeFrameArtifactPayload } from './frame-storage.js';

const WIDTH = 800;
const HEIGHT = 480;
const PIXELS = WIDTH * HEIGHT;
const HEADER_RAW = Buffer.from(['P'.charCodeAt(0), 'F'.charCodeAt(0), '7'.charCodeAt(0), 'A'.charCodeAt(0), 0x20, 0x03, 0xe0, 0x01]);
const HEADER_RLE = Buffer.from(['P'.charCodeAt(0), 'F'.charCodeAt(0), '7'.charCodeAt(0), 'C'.charCodeAt(0), 0x20, 0x03, 0xe0, 0x01]);

test('passes through valid pf7a payloads', () => {
	const pixels = Buffer.alloc(PIXELS, 1);
	const payload = Buffer.concat([HEADER_RAW, pixels]);

	const normalized = normalizeFrameArtifactPayload(payload);
	assert.ok(normalized);
	assert.deepEqual(decodeFrameArtifactPayload(normalized), pixels);
});

test('converts renamed legacy indexed payloads', () => {
	const legacy = Buffer.alloc(PIXELS, 2);
	const normalized = normalizeFrameArtifactPayload(legacy);

	assert.ok(normalized);
	assert.ok(normalized.subarray(0, 4).equals(HEADER_RAW.subarray(0, 4)) || normalized.subarray(0, 4).equals(HEADER_RLE.subarray(0, 4)));
	assert.deepEqual(decodeFrameArtifactPayload(normalized), legacy);
});

test('rejects invalid payloads', () => {
	assert.equal(normalizeFrameArtifactPayload(Buffer.alloc(10, 1)), null);
	assert.equal(normalizeFrameArtifactPayload(Buffer.alloc(PIXELS, 16)), null);
});

test('rewrites legacy files in place', async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf7a-'));
	const filePath = path.join(dir, 'legacy.pf7a');
	await fs.writeFile(filePath, Buffer.alloc(PIXELS, 3));

	const normalized = await ensureFrameArtifactFile(filePath);
	const written = await fs.readFile(filePath);

	assert.ok(normalized);
	assert.deepEqual(written, normalized);
	assert.deepEqual(decodeFrameArtifactPayload(written), Buffer.alloc(PIXELS, 3));
});

test('decodes valid pf7c payloads', () => {
	const source = Buffer.alloc(PIXELS, 6);
	source[0] = 4;
	source[1] = 4;
	source[2] = 4;
	source[3] = 1;
	const normalized = normalizeFrameArtifactPayload(Buffer.concat([HEADER_RAW, source]));
	assert.ok(normalized);
	assert.ok(normalized.subarray(0, 4).equals(HEADER_RLE.subarray(0, 4)));
	const decoded = decodeFrameArtifactPayload(normalized);
	assert.ok(decoded);
	assert.equal(decoded[0], 4);
	assert.equal(decoded[1], 4);
	assert.equal(decoded[2], 4);
	assert.equal(decoded[3], 1);
});
