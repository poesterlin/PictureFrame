import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { renderPluginPreview } from '../preview';
import { mannheimEventsPlugin } from './mannheim-events';

const input = {
	events: [
		...['18.08.2026', '19.08.2026', '20.08.2026'].map((date, index) => ({
			id: `exhibition-${index}`,
			title: 'A long-running exhibition',
			date,
			time: '10:00',
			venue: 'Museum',
			address: '68159 Mannheim',
			url: `https://www.mannheim.de/exhibition-${index}`
		})),
		{
			id: 'concert',
			title: 'Concert at Alte Feuerwache',
			date: '18.08.2026',
			time: '20:00',
			venue: 'Alte Feuerwache',
			address: '68167 Brückenstraße 2',
			url: 'https://www.mannheim.de/concert'
		},
		{
			id: 'market',
			title: 'Evening market',
			date: '19.08.2026',
			time: '17:00',
			venue: 'Marktplatz',
			address: '68159 Mannheim',
			url: 'https://www.mannheim.de/market'
		}
	]
};

describe('Mannheim events plugin', () => {
	test('excludes titles listed on more than the configured number of dates', () => {
		const config = mannheimEventsPlugin.configSchema.parse({ maxDurationDays: 2 });
		const result = mannheimEventsPlugin.evaluate(mannheimEventsPlugin.normalize(input), {
			config,
			now: new Date('2026-08-18T09:00:00+02:00')
		});

		expect(result.model?.events.map((event) => event.id)).toEqual(['concert', 'market']);
	});

	test('allows longer listings when configured', () => {
		const config = mannheimEventsPlugin.configSchema.parse({ maxDurationDays: 3 });
		const result = mannheimEventsPlugin.evaluate(mannheimEventsPlugin.normalize(input), {
			config,
			now: new Date('2026-08-18T09:00:00+02:00')
		});

		expect(result.model?.events.some((event) => event.title.includes('exhibition'))).toBe(true);
	});

	test('renders an 800 by 480 palette preview', async () => {
		const result = await renderPluginPreview({
			pluginKey: 'mannheim-events',
			input,
			config: { maxDurationDays: 2 },
			now: new Date('2026-08-18T09:00:00+02:00')
		});
		expect(result.active).toBe(true);
		if (!result.active) return;
		const metadata = await sharp(result.png).metadata();
		expect([metadata.width, metadata.height]).toEqual([800, 480]);
	});
});
