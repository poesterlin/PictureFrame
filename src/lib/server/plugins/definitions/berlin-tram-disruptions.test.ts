import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderPluginPreview } from '../preview';
import { berlinTramDisruptionsPlugin } from './berlin-tram-disruptions';

const input = JSON.parse(
	readFileSync('scripts/plugin-fixtures/berlin-tram-disruptions-input.json', 'utf8')
);

describe('Berlin tram disruptions plugin', () => {
	test('keeps tram traffic notices and supports line filtering', async () => {
		const config = berlinTramDisruptionsPlugin.configSchema.parse({ lines: ['M8'] });
		const evaluation = await berlinTramDisruptionsPlugin.evaluate(
			berlinTramDisruptionsPlugin.normalize(input),
			{ config, now: new Date('2026-08-09T10:00:00+02:00') }
		);
		expect(evaluation.model?.alerts.map((alert) => alert.id)).toEqual(['tram-m8']);
	});

	test('renders an 800 by 480 palette preview', async () => {
		const result = await renderPluginPreview({
			pluginKey: 'berlin-tram-disruptions',
			input,
			config: {},
			now: new Date('2026-08-09T10:00:00+02:00')
		});
		expect(result.active).toBe(true);
		if (!result.active) return;
		const metadata = await sharp(result.png).metadata();
		expect([metadata.width, metadata.height]).toEqual([800, 480]);
	});
});
