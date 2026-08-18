import { z } from 'zod';
import { layoutStack1D } from '../layout';
import type { ContentPlugin } from '../types';

const lineSchema = z.object({
	number: z.string(),
	name: z.string().optional(),
	operator: z.object({ name: z.string() }).optional()
});

const noticeSchema = z.object({
	id: z.union([z.string(), z.number()]).transform(String),
	type: z.string(),
	priority: z.string().optional(),
	timestamps: z.object({
		validity: z.array(
			z.object({
				from: z.string(),
				to: z.string().optional(),
				isOpenEnd: z.boolean().optional()
			})
		)
	}),
	infoLinks: z.array(
		z.object({
			title: z.string().optional(),
			subtitle: z.string().optional(),
			content: z.string().optional()
		})
	),
	properties: z.object({ AlertCause: z.string().optional() }).passthrough().optional(),
	affected: z.object({ lines: z.array(lineSchema).optional() }).passthrough()
});

const responseSchema = z.object({
	infos: z.object({ current: z.array(noticeSchema) })
});

export const stuttgartStadtbahnDisruptionsConfigSchema = z.object({
	title: z.string().min(1).max(40).default('STUTTGART / STADTBAHN'),
	maxDisruptions: z.number().int().min(1).max(4).default(4),
	lines: z.array(z.string().min(2).max(8)).max(20).default([]),
	daysAhead: z.number().int().min(0).max(90).default(14),
	showDates: z.boolean().default(true)
});

type Config = z.infer<typeof stuttgartStadtbahnDisruptionsConfigSchema>;
type Response = z.infer<typeof responseSchema>;
type Alert = {
	id: string;
	lines: string[];
	headline: string;
	detail: string;
	date: string;
	priority: string;
};
type Model = { title: string; alerts: Alert[] };

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

function getStadtbahnLines(notice: Response['infos']['current'][number]): string[] {
	return [
		...new Set(
			(notice.affected.lines ?? [])
				.map((line) => line.number.toUpperCase())
				.filter((line) => /^U\d+[A-Z]?$/.test(line))
		)
	];
}

export const stuttgartStadtbahnDisruptionsPlugin: ContentPlugin<Config, Response, Model> = {
	key: 'stuttgart-stadtbahn-disruptions',
	label: 'Stuttgart Stadtbahn disruptions',
	version: 1,
	configSchema: stuttgartStadtbahnDisruptionsConfigSchema,
	normalize(input) {
		return responseSchema.parse(input);
	},
	evaluate(data, { config, now }) {
		const configuredLines = new Set(config.lines.map((line) => line.toUpperCase()));
		const latestStart = new Date(now.getTime() + config.daysAhead * 86_400_000).getTime();
		const alerts = data.infos.current
			.map((notice): Alert | null => {
				const lines = getStadtbahnLines(notice);
				const validity = notice.timestamps.validity[0];
				if (!validity || lines.length === 0) return null;
				const from = new Date(validity.from).getTime();
				const to = validity.to ? new Date(validity.to).getTime() : Number.POSITIVE_INFINITY;
				if (from > latestStart || to < now.getTime()) return null;
				const info = notice.infoLinks[0];
				return {
					id: notice.id,
					lines,
					headline: info?.subtitle || info?.title || 'Betriebsänderung',
					detail: info?.title || notice.properties?.AlertCause || 'Aktuelle Meldung',
					date: config.showDates
						? validity.to
							? `${formatDate(validity.from)}–${formatDate(validity.to)}`
							: `seit ${formatDate(validity.from)}`
						: '',
					priority: notice.priority || 'normal'
				};
			})
			.filter((alert): alert is Alert => alert !== null)
			.filter(
				(alert) =>
					configuredLines.size === 0 || alert.lines.some((line) => configuredLines.has(line))
			)
			.sort((left, right) => Number(right.priority === 'high') - Number(left.priority === 'high'))
			.slice(0, config.maxDisruptions);

		return {
			active: alerts.length > 0,
			meaningfulData: alerts,
			model: { title: config.title, alerts },
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
				return `<g transform="translate(0 ${box.start.toFixed(2)})">
					<rect x="22" y="0" width="756" height="${box.size.toFixed(2)}" rx="9" fill="${index % 2 ? 'url(#green-dots)' : 'white'}" stroke="black" stroke-width="2"/>
					<rect x="35" y="12" width="118" height="${Math.max(48, box.size - 24).toFixed(2)}" rx="6" fill="blue" stroke="black" stroke-width="2"/>
					<text x="94" y="${(box.size / 2 + 10).toFixed(2)}" text-anchor="middle" font-family="sans-serif" font-size="${lineFontSize}" font-weight="800" fill="white">${escapeXml(lineText)}</text>
					<text x="172" y="28" font-family="sans-serif" font-size="19" font-weight="800" fill="black">${escapeXml(truncate(alert.headline, 51))}</text>
					<text x="172" y="52" font-family="sans-serif" font-size="14" font-weight="700" fill="red">${escapeXml(truncate([alert.detail, alert.date].filter(Boolean).join('  ·  ').toUpperCase(), 67))}</text>
				</g>`;
			})
			.join('');

		return Buffer.from(`<svg width="800" height="480" viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg">
			<defs><pattern id="green-dots" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="white"/><circle cx="3" cy="3" r="1" fill="green"/></pattern></defs>
			<rect width="800" height="480" fill="white"/>
			<rect x="18" y="${header.start}" width="764" height="${header.size}" rx="10" fill="blue"/>
			<rect x="29" y="${header.start + 10}" width="742" height="${header.size - 20}" rx="5" fill="white"/>
			<text x="48" y="${header.start + 43}" font-family="sans-serif" font-size="29" font-weight="800" fill="black">${escapeXml(model.title)}</text>
			<text x="748" y="${header.start + 40}" text-anchor="end" font-family="sans-serif" font-size="15" font-weight="800" fill="blue">${model.alerts.length} MELDUNGEN</text>
			${rows}
		</svg>`);
	}
};
