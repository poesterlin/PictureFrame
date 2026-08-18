import { describe, expect, test } from 'bun:test';
import { decodeFrameArtifactPayload } from '../../../../../realtime/frame-storage.js';
import { encodeImageAsFrame } from '../../frame-image';
import { hashPluginValue } from '../hash';
import { renderPluginPreview } from '../preview';
import { squarePlugin } from './square';
import sharp from 'sharp';

describe('square plugin', () => {
	test('renders a valid 800x480 PF7A artifact', async () => {
		const config = squarePlugin.configSchema.parse({});
		const evaluation = await squarePlugin.evaluate(squarePlugin.normalize({ ignored: true }), {
			config,
			now: new Date('2026-01-01T00:00:00Z')
		});

		expect(evaluation.active).toBe(true);
		expect(evaluation.model).toBeDefined();
		const svg = await squarePlugin.render(evaluation.model!, { config });
		const encoded = await encodeImageAsFrame(svg);
		const pixels = decodeFrameArtifactPayload(encoded.artifact);

		expect(pixels).not.toBeNull();
		expect(pixels?.length).toBe(800 * 480);
		expect(new Set(pixels).has(0)).toBe(true);
		expect(new Set(pixels).has(1)).toBe(true);
	});

	test('canonical hashes do not depend on object key order', () => {
		expect(hashPluginValue({ b: 2, a: 1 })).toBe(hashPluginValue({ a: 1, b: 2 }));
	});

	test('preview harness returns an 800x480 PNG', async () => {
		const result = await renderPluginPreview({
			pluginKey: 'square',
			input: { any: 'json' },
			config: { fill: 'red' },
			now: new Date('2026-01-01T00:00:00Z')
		});

		expect(result.active).toBe(true);
		if (!result.active) return;
		const metadata = await sharp(result.png).metadata();
		expect(metadata.format).toBe('png');
		expect(metadata.width).toBe(800);
		expect(metadata.height).toBe(480);
	});
});
