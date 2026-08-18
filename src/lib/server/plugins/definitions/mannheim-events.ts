import { z } from 'zod';
import { layoutStack1D } from '../layout';
import { qrSvg } from '../qr';
import { fetchMannheimEventOccurrences, MANNHEIM_EVENTS_URL } from '../sources/mannheim-events';
import type { ContentPlugin } from '../types';

const occurrenceSchema = z.object({
	id: z.string(),
	title: z.string(),
	date: z.string(),
	time: z.string().default(''),
	venue: z.string().default(''),
	address: z.string().default(''),
	url: z.string().url()
});

const responseSchema = z.object({ events: z.array(occurrenceSchema) });
const configSchema = z
	.object({
		title: z.string().trim().min(1).max(40).default('MANNHEIM EVENTS'),
		maxEvents: z.number().int().min(1).max(4).default(4),
		daysAhead: z.number().int().min(0).max(30).default(14),
		maxDurationDays: z.number().int().min(1).max(30).default(2),
		excludeWorkHours: z.boolean().default(false),
		workdayStartHour: z.number().int().min(0).max(23).default(9),
		workdayEndHour: z.number().int().min(1).max(24).default(17),
		showVenue: z.boolean().default(true),
		accent: z.enum(['red', 'blue', 'green', 'orange']).default('blue')
	})
	.refine((config) => config.workdayEndHour > config.workdayStartHour, {
		message: 'Workday end must be later than workday start'
	});

type Config = z.infer<typeof configSchema>;
type Response = z.infer<typeof responseSchema>;
type Event = Response['events'][number] & { dateKey: number };
type Model = { title: string; showVenue: boolean; accent: Config['accent']; events: Event[] };

const months = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];
const violet = 'rgb(100,81,116)';

function parseDate(value: string) {
	const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
	if (!match) return null;
	const day = Number(match[1]);
	const month = Number(match[2]);
	const year = Number(match[3]);
	const probe = new Date(Date.UTC(year, month - 1, day));
	if (probe.getUTCDate() !== day || probe.getUTCMonth() !== month - 1) return null;
	return { day, month, key: year * 10_000 + month * 100 + day };
}

function dateKey(date: Date) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Berlin',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return Number(values.year) * 10_000 + Number(values.month) * 100 + Number(values.day);
}

function addDays(key: number, days: number) {
	const year = Math.floor(key / 10_000);
	const month = Math.floor((key % 10_000) / 100);
	const day = key % 100;
	const result = new Date(Date.UTC(year, month - 1, day + days));
	return result.getUTCFullYear() * 10_000 + (result.getUTCMonth() + 1) * 100 + result.getUTCDate();
}

function escapeXml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function truncate(value: string, length: number) {
	return value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;
}

function wrap(value: string, length: number): [string, string?] {
	const words = value.trim().split(/\s+/);
	let first = '';
	let second = '';
	for (const word of words) {
		if (!first || `${first} ${word}`.length <= length) {
			first = first ? `${first} ${word}` : word;
		} else {
			const next = second ? `${second} ${word}` : word;
			second = next.length <= length ? next : truncate(next, length);
		}
	}
	return [truncate(first, length), second ? truncate(second, length) : undefined];
}

function normalizedTitle(title: string) {
	return title.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
}

function isDuringWorkHours(event: Event, config: Config) {
	if (!config.excludeWorkHours) return false;
	const parsedDate = parseDate(event.date);
	const parsedTime = /^(\d{1,2})(?::(\d{2}))?/.exec(event.time);
	if (!parsedDate || !parsedTime) return false;
	const weekday = new Date(
		Date.UTC(
			Math.floor(parsedDate.key / 10_000),
			Math.floor((parsedDate.key % 10_000) / 100) - 1,
			parsedDate.day
		)
	).getUTCDay();
	if (weekday === 0 || weekday === 6) return false;
	const minutes = Number(parsedTime[1]) * 60 + Number(parsedTime[2] ?? 0);
	return minutes >= config.workdayStartHour * 60 && minutes < config.workdayEndHour * 60;
}

export const mannheimEventsPlugin: ContentPlugin<Config, Response, Model> = {
	key: 'mannheim-events',
	label: 'Mannheim events',
	version: 5,
	configSchema,
	async fetchInput() {
		return { events: await fetchMannheimEventOccurrences() };
	},
	normalize(input) {
		return responseSchema.parse(input);
	},
	evaluate(data, { config, now }) {
		const today = dateKey(now);
		const lastDay = addDays(today, config.daysAhead);
		const titleDates = new Map<string, Set<number>>();
		const normalized = data.events
			.map((event) => {
				const parsed = parseDate(event.date);
				return parsed ? { ...event, dateKey: parsed.key } : null;
			})
			.filter((event): event is Event => event !== null);

		for (const event of normalized) {
			const title = normalizedTitle(event.title);
			const dates = titleDates.get(title) ?? new Set<number>();
			dates.add(event.dateKey);
			titleDates.set(title, dates);
		}

		const events = normalized
			.filter((event) => event.dateKey >= today && event.dateKey <= lastDay)
			.filter((event) => !isDuringWorkHours(event, config))
			.filter(
				(event) =>
					(titleDates.get(normalizedTitle(event.title))?.size ?? 1) <= config.maxDurationDays
			)
			.sort((left, right) => left.dateKey - right.dateKey || left.time.localeCompare(right.time))
			.slice(0, config.maxEvents);

		return {
			active: events.length > 0,
			meaningfulData: events.map(({ dateKey: _dateKey, ...event }) => event),
			model: { title: config.title, showVenue: config.showVenue, accent: config.accent, events },
			nextEvaluationAt: new Date(now.getTime() + 60 * 60 * 1000)
		};
	},
	render(model) {
		const layout = layoutStack1D({
			start: 16,
			length: 448,
			gap: 8,
			items: [
				{ id: 'header', basis: 64 },
				...model.events.map((event) => ({ id: event.id, grow: 1 }))
			]
		});
		const header = layout[0];
		const boxes = layout.slice(1);
		const markerY = 36;
		const rows = model.events
			.map((event, index) => {
				const parsed = parseDate(event.date)!;
				const box = boxes[index];
				const [first, second] = wrap(event.title, 44);
				const venue = model.showVenue
					? [event.venue, event.address].filter(Boolean).join(' · ')
					: event.venue;
				return `<g transform="translate(0 ${box.start.toFixed(2)})">
				<rect x="116" width="660" height="${box.size.toFixed(2)}" rx="8" fill="url(#dots-${index % 2})"/>
				<rect x="122" y="5" width="648" height="${(box.size - 10).toFixed(2)}" rx="5" fill="white"/>
				<circle cx="88" cy="${markerY}" r="8" fill="${model.accent}" stroke="${violet}" stroke-width="2"/>
				<text x="24" y="35" font-family="sans-serif" font-size="31" font-weight="700">${String(parsed.day).padStart(2, '0')}</text>
				<text x="24" y="57" font-family="sans-serif" font-size="16" font-weight="700">${months[parsed.month - 1]}</text>
				<text x="130" y="24" font-family="sans-serif" font-size="23" font-weight="700">${escapeXml(first)}</text>
				${second ? `<text x="130" y="46" font-family="sans-serif" font-size="23" font-weight="700">${escapeXml(second)}</text>` : ''}
				<text x="130" y="${second ? 66 : 48}" clip-path="url(#venue-clip)" font-family="sans-serif" font-size="16" font-weight="700">${escapeXml(venue)}</text>
				<text x="754" y="${second ? 66 : 48}" text-anchor="end" font-family="sans-serif" font-size="16" font-weight="700">${escapeXml(event.time)}</text>
			</g>`;
			})
			.join('');

		return Buffer.from(`<svg width="800" height="480" viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<clipPath id="venue-clip"><rect x="130" y="0" width="525" height="100"/></clipPath>
				<pattern id="header" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="white"/><rect x="1" y="1" width="2" height="2" fill="${violet}"/><rect x="5" y="5" width="2" height="2" fill="${model.accent}"/></pattern>
				<pattern id="dots-0" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="white"/><rect x="2" y="2" width="1" height="1" fill="${violet}"/><rect x="8" y="8" width="1" height="1" fill="${model.accent}"/></pattern>
				<pattern id="dots-1" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="white"/><rect x="2" y="2" width="2" height="2" fill="${violet}"/><rect x="8" y="8" width="2" height="2" fill="${model.accent}"/></pattern>
			</defs>
			<rect width="800" height="480" fill="white"/>
			<rect x="16" y="${header.start}" width="768" height="${header.size}" rx="9" fill="url(#header)"/>
			<rect x="31" y="${header.start + 8}" width="738" height="${header.size - 16}" rx="5" fill="white"/>
			<text x="48" y="${header.start + 43}" font-family="sans-serif" font-size="30" font-weight="700" letter-spacing="0.8">${escapeXml(model.title)}</text>
			<line x1="88" y1="${boxes[0].start + markerY}" x2="88" y2="${boxes[boxes.length - 1].start + markerY}" stroke="${violet}" stroke-width="2" stroke-dasharray="2 6"/>
			${rows}
			${qrSvg(MANNHEIM_EVENTS_URL, 722, 8, { moduleSize: 2, margin: 3 })}
		</svg>`);
	}
};
