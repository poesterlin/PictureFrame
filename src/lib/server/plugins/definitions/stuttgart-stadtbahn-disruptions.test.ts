import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderPluginPreview } from '../preview';
import { stuttgartStadtbahnDisruptionsPlugin } from './stuttgart-stadtbahn-disruptions';

const input = JSON.parse(
	readFileSync('scripts/plugin-fixtures/stuttgart-stadtbahn-disruptions-input.json', 'utf8')
);

describe('Stuttgart Stadtbahn disruptions plugin', () => {
	test('keeps current Stadtbahn notices and supports line filtering', async () => {
		const config = stuttgartStadtbahnDisruptionsPlugin.configSchema.parse({ lines: ['U13'] });
		const evaluation = await stuttgartStadtbahnDisruptionsPlugin.evaluate(
			stuttgartStadtbahnDisruptionsPlugin.normalize(input),
			{ config, now: new Date('2026-08-09T10:00:00+02:00') }
		);
		expect(evaluation.model?.alerts.map((alert) => alert.id)).toEqual(['ems-u13']);
	});

	test('renders an 800 by 480 palette preview', async () => {
		const result = await renderPluginPreview({
			pluginKey: 'stuttgart-stadtbahn-disruptions',
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
