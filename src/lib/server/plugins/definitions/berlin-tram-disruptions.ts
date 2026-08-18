import { z } from 'zod';
import { layoutStack1D } from '../layout';
import type { ContentPlugin } from '../types';

const tramLineSchema = z.object({
	name: z.string(),
	slug: z.string().optional(),
	lineType: z.number().optional(),
	isExternal: z.boolean().optional()
});

const disruptionSchema = z.object({
	id: z.union([z.string(), z.number()]).transform(String),
	messageType: z.string(),
	disruptionTypes: z.array(z.object({ displayName: z.string(), color: z.string().optional() })),
	stationOne: z.object({ displayName: z.string() }).optional(),
	stationTwo: z.object({ displayName: z.string() }).optional(),
	lines: z.array(z.object({ tram: z.array(tramLineSchema).optional() }).passthrough()),
	content: z.array(z.object({ headline: z.string().optional(), content: z.string().optional() })),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	modDate: z.string().optional(),
	scheduled: z.boolean().optional()
});

const responseSchema = z.object({ elements: z.array(disruptionSchema) });

export const berlinTramDisruptionsConfigSchema = z.object({
	title: z.string().min(1).max(40).default('BERLIN / TRAM-LAGE'),
	maxDisruptions: z.number().int().min(1).max(4).default(4),
	lines: z.array(z.string().min(1).max(8)).max(20).default([]),
	showDates: z.boolean().default(true)
});

type Config = z.infer<typeof berlinTramDisruptionsConfigSchema>;
type Response = z.infer<typeof responseSchema>;
type Alert = {
	id: string;
	lines: string[];
	type: string;
	headline: string;
	stations: string;
	date: string;
};
type Model = { title: string; alerts: Alert[]; showDates: boolean };

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function truncate(value: string, length: number): string {
	return value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;
}

function formatDate(value?: string): string {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('de-DE', {
		timeZone: 'Europe/Berlin',
		day: '2-digit',
		month: '2-digit'
	}).format(date);
}

function alertFromDisruption(
	disruption: Response['elements'][number],
	showDates: boolean
): Alert | null {
	const lines = [
		...new Set(disruption.lines.flatMap((group) => group.tram?.map((line) => line.name) ?? []))
	];
	if (lines.length === 0 || disruption.messageType !== 'TRAFFIC') return null;
	const stations = [disruption.stationOne?.displayName, disruption.stationTwo?.displayName]
		.filter(Boolean)
		.join(' ↔ ')
		.replaceAll('\u200b', '');
	const start = formatDate(disruption.startDate);
	const end = formatDate(disruption.endDate);
	return {
		id: disruption.id,
		lines,
		type: disruption.disruptionTypes.map((type) => type.displayName).join(' + ') || 'Meldung',
		headline:
			disruption.content[0]?.headline || disruption.disruptionTypes[0]?.displayName || 'Störung',
		stations,
		date: showDates ? (end ? `${start}–${end}` : start ? `seit ${start}` : '') : ''
	};
}

export const berlinTramDisruptionsPlugin: ContentPlugin<Config, Response, Model> = {
	key: 'berlin-tram-disruptions',
	label: 'Berlin tram disruptions',
	version: 1,
	configSchema: berlinTramDisruptionsConfigSchema,
	normalize(input) {
		return responseSchema.parse(input);
	},
	evaluate(data, { config, now }) {
		const configuredLines = new Set(config.lines.map((line) => line.toUpperCase()));
		const alerts = data.elements
			.map((item) => alertFromDisruption(item, config.showDates))
			.filter((alert): alert is Alert => alert !== null)
			.filter(
				(alert) =>
					configuredLines.size === 0 ||
					alert.lines.some((line) => configuredLines.has(line.toUpperCase()))
			)
			.slice(0, config.maxDisruptions);
		return {
			active: alerts.length > 0,
			meaningfulData: alerts,
			model: { title: config.title, alerts, showDates: config.showDates },
			nextEvaluationAt: new Date(now.getTime() + 15 * 60 * 1000)
		};
	},
	render(model) {
		const layout = layoutStack1D({
			start: 18,
			length: 444,
			gap: 9,
			items: [
				{ id: 'header', basis: 62 },
				...model.alerts.map((alert) => ({ id: alert.id, grow: 1 }))
			]
		});
		const header = layout[0];
		const rows = model.alerts
			.map((alert, index) => {
				const box = layout[index + 1];
				const lineText = truncate(alert.lines.join(' · '), 18);
				const lineFontSize = lineText.length > 8 ? 17 : lineText.length > 5 ? 21 : 25;
				const rightLabel = [alert.type, alert.date].filter(Boolean).join('  ·  ');
				return `<g transform="translate(0 ${box.start.toFixed(2)})">
					<rect x="22" y="0" width="756" height="${box.size.toFixed(2)}" rx="9" fill="${index % 2 ? 'url(#blue-dots)' : 'white'}" stroke="black" stroke-width="2"/>
					<rect x="35" y="12" width="118" height="${Math.max(48, box.size - 24).toFixed(2)}" rx="6" fill="yellow" stroke="black" stroke-width="2"/>
					<text x="94" y="${(box.size / 2 + 10).toFixed(2)}" text-anchor="middle" font-family="sans-serif" font-size="${lineFontSize}" font-weight="800" fill="black">${escapeXml(lineText)}</text>
					<text x="172" y="28" font-family="sans-serif" font-size="20" font-weight="800" fill="black">${escapeXml(truncate(alert.headline, 49))}</text>
					<text x="172" y="51" font-family="sans-serif" font-size="14" font-weight="700" fill="red">${escapeXml(truncate(rightLabel.toUpperCase(), 67))}</text>
					<text x="172" y="73" font-family="sans-serif" font-size="15" fill="black">${escapeXml(truncate(alert.stations, 67))}</text>
				</g>`;
			})
			.join('');

		return Buffer.from(`<svg width="800" height="480" viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg">
			<defs><pattern id="blue-dots" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="white"/><circle cx="3" cy="3" r="1" fill="blue"/></pattern></defs>
			<rect width="800" height="480" fill="white"/>
			<rect x="18" y="${header.start}" width="764" height="${header.size}" rx="10" fill="black"/>
			<rect x="29" y="${header.start + 10}" width="742" height="${header.size - 20}" rx="5" fill="yellow"/>
			<text x="48" y="${header.start + 43}" font-family="sans-serif" font-size="31" font-weight="800" fill="black">${escapeXml(model.title)}</text>
			<text x="748" y="${header.start + 40}" text-anchor="end" font-family="sans-serif" font-size="15" font-weight="800" fill="black">${model.alerts.length} MELDUNGEN</text>
			${rows}
		</svg>`);
	}
};
