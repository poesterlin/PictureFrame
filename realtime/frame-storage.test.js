import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	decodeFrameArtifactPayload,
	ensureFrameArtifactFile,
	listArtifactKeys,
	normalizeFrameArtifactPayload
} from './frame-storage.js';

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

test('decodes nibble-packed pf7a payloads', () => {
	const packed = Buffer.alloc(PIXELS / 2);
	for (let i = 0; i < packed.length; i++) {
		packed[i] = 0x34;
	}
	const payload = Buffer.concat([HEADER_RAW, packed]);
	const decoded = decodeFrameArtifactPayload(payload);
	assert.ok(decoded);
	assert.equal(decoded.length, PIXELS);
	assert.equal(decoded[0], 3);
	assert.equal(decoded[1], 4);
	assert.equal(decoded[2], 3);
	assert.equal(decoded[3], 4);
});

test('converts legacy nibble-packed payloads without header', () => {
	const legacyPacked = Buffer.alloc(PIXELS / 2, 0x56);
	const normalized = normalizeFrameArtifactPayload(legacyPacked);
	assert.ok(normalized);
	const decoded = decodeFrameArtifactPayload(normalized);
	assert.ok(decoded);
	assert.equal(decoded.length, PIXELS);
	assert.equal(decoded[0], 5);
	assert.equal(decoded[1], 6);
	assert.equal(decoded[2], 5);
	assert.equal(decoded[3], 6);
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

test('listArtifactKeys includes pf7a and pf7c files', async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf7-list-'));
	const previousFramesDir = process.env.FRAMES_DIR;
	process.env.FRAMES_DIR = dir;

	try {
		const ownerDir = path.join(dir, 'tester');
		await fs.mkdir(ownerDir, { recursive: true });

		const pf7aPixels = Buffer.alloc(PIXELS, 1);
		const pf7aPayload = Buffer.concat([HEADER_RAW, pf7aPixels]);
		await fs.writeFile(path.join(ownerDir, 'a.pf7a'), pf7aPayload);

		const pf7cPixels = Buffer.alloc(PIXELS, 2);
		const pf7cPayload = normalizeFrameArtifactPayload(Buffer.concat([HEADER_RAW, pf7cPixels]));
		assert.ok(pf7cPayload);
		assert.ok(pf7cPayload.subarray(0, 4).equals(HEADER_RLE.subarray(0, 4)));
		await fs.writeFile(path.join(ownerDir, 'b.pf7c'), pf7cPayload);

		const keys = await listArtifactKeys();
		assert.ok(keys.includes('frames/tester/a.pf7a'));
		assert.ok(keys.includes('frames/tester/b.pf7c'));
	} finally {
		if (previousFramesDir === undefined) {
			delete process.env.FRAMES_DIR;
		} else {
			process.env.FRAMES_DIR = previousFramesDir;
		}
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test('decodes pf7c where palette index is nibble-replicated byte', () => {
	const header = HEADER_RLE;
	const body = Buffer.alloc((PIXELS / 128) * 2);
	for (let i = 0; i < body.length; i += 2) {
		body[i] = 255;
		body[i + 1] = 0x66;
	}
	const payload = Buffer.concat([header, body]);
	const decoded = decodeFrameArtifactPayload(payload);
	assert.ok(decoded);
	assert.equal(decoded.length, PIXELS);
	assert.equal(decoded[0], 6);
	assert.equal(decoded[1], 6);
});

test('decodes pf7c stream that expands to packed pixel bytes', () => {
	const packedLen = PIXELS / 2;
	const body = Buffer.alloc((packedLen / 128) * 2);
	for (let i = 0; i < body.length; i += 2) {
		body[i] = 255;
		body[i + 1] = 0x12;
	}
	const payload = Buffer.concat([HEADER_RLE, body]);
	const decoded = decodeFrameArtifactPayload(payload);
	assert.ok(decoded);
	assert.equal(decoded.length, PIXELS);
	assert.equal(decoded[0], 1);
	assert.equal(decoded[1], 2);
	assert.equal(decoded[2], 1);
	assert.equal(decoded[3], 2);
});

test('decodes legacy packbits-style pf7c payloads', () => {
	const body = Buffer.alloc((PIXELS / 128) * 2);
	for (let i = 0; i < body.length; i += 2) {
		body[i] = 129;
		body[i + 1] = 0x33;
	}
	const payload = Buffer.concat([HEADER_RLE, body]);
	const decoded = decodeFrameArtifactPayload(payload);
	assert.ok(decoded);
	assert.equal(decoded.length, PIXELS);
	assert.equal(decoded[0], 3);
	assert.equal(decoded[1], 3);
});

test('lenient pf7c decode accepts slight output overflow', () => {
	const body = Buffer.alloc((PIXELS / 128) * 2 + 2);
	for (let i = 0; i < body.length - 2; i += 2) {
		body[i] = 255;
		body[i + 1] = 0x44;
	}
	body[body.length - 2] = 130;
	body[body.length - 1] = 0x44;

	const payload = Buffer.concat([HEADER_RLE, body]);
	const decoded = decodeFrameArtifactPayload(payload);
	assert.ok(decoded);
	assert.equal(decoded.length, PIXELS);
	assert.equal(decoded[0], 4);
	assert.equal(decoded[1], 4);
});
