import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { renderPluginPreview } from '../preview';
import { berlinEventsPlugin } from './berlin-events';

const apiResponse = {
	index: [
		{
			id: 1,
			bezirk: 'Mitte',
			bezeichnung: 'Museum night',
			strasse: 'Museumsinsel',
			plz: '10178',
			von: '12.08.2026',
			bis: '12.08.2026',
			zeit: '18-02 Uhr'
		},
		{
			id: 2,
			bezirk: 'Neukölln',
			bezeichnung: 'Today in the park',
			strasse: 'Tempelhofer Feld',
			plz: '12049',
			von: '09.08.2026',
			bis: '09.08.2026',
			zeit: '12-20 Uhr'
		},
		{
			id: 3,
			bezirk: 'Brandenburg',
			bezeichnung: 'Outside Berlin',
			strasse: 'Alter Markt',
			plz: '14467',
			von: '10.08.2026',
			bis: '10.08.2026',
			zeit: '10-18 Uhr'
		},
		{
			id: 4,
			bezirk: 'Mitte',
			bezeichnung: 'Past event',
			strasse: '',
			plz: '',
			von: '01.08.2026',
			bis: '02.08.2026',
			zeit: ''
		},
		{
			id: 5,
			bezirk: 'Neukölln',
			bezeichnung: 'Already running',
			strasse: 'Hasenheide',
			plz: '10967',
			von: '01.08.2026',
			bis: '15.08.2026',
			zeit: '10-18 Uhr'
		}
	]
};

describe('Berlin events plugin', () => {
	test('keeps upcoming Berlin events in chronological order', async () => {
		const config = berlinEventsPlugin.configSchema.parse({ daysAhead: 7 });
		const evaluation = await berlinEventsPlugin.evaluate(
			berlinEventsPlugin.normalize(apiResponse),
			{
				config,
				now: new Date('2026-08-09T10:00:00+02:00')
			}
		);

		expect(evaluation.active).toBe(true);
		expect(evaluation.model?.events.map((event) => event.id)).toEqual(['2', '1', '5']);
	});

	test('supports per-instance district filtering', async () => {
		const config = berlinEventsPlugin.configSchema.parse({
			daysAhead: 7,
			districts: ['Mitte']
		});
		const evaluation = await berlinEventsPlugin.evaluate(
			berlinEventsPlugin.normalize(apiResponse),
			{
				config,
				now: new Date('2026-08-09T10:00:00+02:00')
			}
		);

		expect(evaluation.model?.events.map((event) => event.id)).toEqual(['1']);
	});

	test('renders a palette preview PNG', async () => {
		const result = await renderPluginPreview({
			pluginKey: 'berlin-events',
			input: apiResponse,
			config: { daysAhead: 7, accent: 'red' },
			now: new Date('2026-08-09T10:00:00+02:00')
		});

		expect(result.active).toBe(true);
		if (!result.active) return;
		const metadata = await sharp(result.png).metadata();
		expect(metadata.format).toBe('png');
		expect(metadata.width).toBe(800);
		expect(metadata.height).toBe(480);
	});
});
