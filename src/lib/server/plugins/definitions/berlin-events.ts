import { z } from 'zod';
import { layoutStack1D } from '../layout';
import type { ContentPlugin } from '../types';

const berlinEventSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		bezirk: z.string(),
		bezeichnung: z.string(),
		strasse: z.string().default(''),
		plz: z.string().default(''),
		von: z.string(),
		bis: z.string().default(''),
		zeit: z.string().default('')
	})
	.passthrough();

const berlinEventsResponseSchema = z
	.object({
		index: z.array(berlinEventSchema)
	})
	.passthrough();

const berlinEventsConfigSchema = z
	.object({
		title: z.string().trim().min(1).max(40).default('BERLIN EVENTS'),
		maxEvents: z.number().int().min(1).max(4).default(4),
		daysAhead: z.number().int().min(0).max(366).default(30),
		districts: z.array(z.string().trim().min(1)).default([]),
		includeBrandenburg: z.boolean().default(false),
		excludeWorkHours: z.boolean().default(false),
		workdayStartHour: z.number().int().min(0).max(23).default(9),
		workdayEndHour: z.number().int().min(1).max(24).default(17),
		showAddress: z.boolean().default(true),
		accent: z.enum(['red', 'blue', 'green', 'orange']).default('red')
	})
	.refine((config) => config.workdayEndHour > config.workdayStartHour, {
		message: 'Workday end must be later than workday start'
	});

type BerlinEventsConfig = z.infer<typeof berlinEventsConfigSchema>;
type BerlinEventsResponse = z.infer<typeof berlinEventsResponseSchema>;

type DisplayEvent = {
	id: string;
	district: string;
	title: string;
	street: string;
	postalCode: string;
	startDate: string;
	endDate: string;
	time: string;
	startDateKey: number;
	endDateKey: number;
};

type BerlinEventsModel = {
	title: string;
	accent: BerlinEventsConfig['accent'];
	showAddress: boolean;
	events: DisplayEvent[];
};

const germanMonths = [
	'JAN',
	'FEB',
	'MÄR',
	'APR',
	'MAI',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OKT',
	'NOV',
	'DEZ'
];
const timelineColor = 'rgb(100,81,116)';

function parseGermanDate(
	value: string
): { key: number; day: number; month: number; year: number } | null {
	const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
	if (!match) return null;
	const day = Number(match[1]);
	const month = Number(match[2]);
	const year = Number(match[3]);
	const probe = new Date(Date.UTC(year, month - 1, day));
	if (
		probe.getUTCFullYear() !== year ||
		probe.getUTCMonth() !== month - 1 ||
		probe.getUTCDate() !== day
	) {
		return null;
	}
	return { key: year * 10_000 + month * 100 + day, day, month, year };
}

function dateKeyInBerlin(date: Date): number {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Berlin',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return Number(value.year) * 10_000 + Number(value.month) * 100 + Number(value.day);
}

function addDaysToDateKey(dateKey: number, days: number): number {
	const year = Math.floor(dateKey / 10_000);
	const month = Math.floor((dateKey % 10_000) / 100);
	const day = dateKey % 100;
	const result = new Date(Date.UTC(year, month - 1, day + days));
	return result.getUTCFullYear() * 10_000 + (result.getUTCMonth() + 1) * 100 + result.getUTCDate();
}

function normalizeEvent(event: BerlinEventsResponse['index'][number]): DisplayEvent | null {
	const start = parseGermanDate(event.von);
	const end = parseGermanDate(event.bis || event.von);
	if (!start || !end || end.key < start.key) return null;

	return {
		id: String(event.id),
		district: event.bezirk.trim(),
		title: event.bezeichnung.trim(),
		street: event.strasse.trim(),
		postalCode: event.plz.trim(),
		startDate: event.von.trim(),
		endDate: (event.bis || event.von).trim(),
		time: event.zeit.trim(),
		startDateKey: start.key,
		endDateKey: end.key
	};
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function wrapTitle(value: string, maxCharacters: number): [string, string?] {
	const words = value.trim().split(/\s+/);
	let first = '';
	let second = '';

	for (const word of words) {
		const target = first.length < maxCharacters ? 'first' : 'second';
		if (target === 'first') {
			const candidate = first ? `${first} ${word}` : word;
			if (candidate.length <= maxCharacters || !first) {
				first = candidate;
				continue;
			}
		}
		const candidate = second ? `${second} ${word}` : word;
		second = candidate.length <= maxCharacters ? candidate : truncate(candidate, maxCharacters);
		if (second.endsWith('…')) break;
	}

	return [truncate(first, maxCharacters), second ? truncate(second, maxCharacters) : undefined];
}

function formatDateRange(event: DisplayEvent): { day: string; month: string; range: string } {
	const start = parseGermanDate(event.startDate)!;
	const end = parseGermanDate(event.endDate)!;
	const range = start.key === end.key ? event.time : `${event.startDate} – ${event.endDate}`;
	return {
		day: String(start.day).padStart(2, '0'),
		month: germanMonths[start.month - 1],
		range
	};
}

function isDuringWorkHours(event: DisplayEvent, config: BerlinEventsConfig): boolean {
	if (!config.excludeWorkHours || event.startDateKey !== event.endDateKey) return false;
	const start = parseGermanDate(event.startDate);
	const parsedTime = /^(\d{1,2})(?::(\d{2}))?/.exec(event.time);
	if (!start || !parsedTime) return false;
	const weekday = new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay();
	if (weekday === 0 || weekday === 6) return false;
	const minutes = Number(parsedTime[1]) * 60 + Number(parsedTime[2] ?? 0);
	return minutes >= config.workdayStartHour * 60 && minutes < config.workdayEndHour * 60;
}

export const berlinEventsPlugin: ContentPlugin<
	BerlinEventsConfig,
	BerlinEventsResponse,
	BerlinEventsModel
> = {
	key: 'berlin-events',
	label: 'Berlin events',
	version: 5,
	configSchema: berlinEventsConfigSchema,
	normalize(input) {
		return berlinEventsResponseSchema.parse(input);
	},
	evaluate(data, { config, now }) {
		const today = dateKeyInBerlin(now);
		const lastDay = addDaysToDateKey(today, config.daysAhead);
		const configuredDistricts = new Set(config.districts.map((district) => district.toLowerCase()));
		const events = data.index
			.map(normalizeEvent)
			.filter((event): event is DisplayEvent => event !== null)
			.filter((event) => event.endDateKey >= today && event.startDateKey <= lastDay)
			.filter((event) => !isDuringWorkHours(event, config))
			.filter((event) => config.includeBrandenburg || event.district !== 'Brandenburg')
			.filter(
				(event) =>
					configuredDistricts.size === 0 || configuredDistricts.has(event.district.toLowerCase())
			)
			.sort((left, right) => {
				const leftIsOngoing = left.startDateKey < today;
				const rightIsOngoing = right.startDateKey < today;
				if (leftIsOngoing !== rightIsOngoing) return leftIsOngoing ? 1 : -1;
				return (
					left.startDateKey - right.startDateKey || left.title.localeCompare(right.title, 'de')
				);
			})
			.slice(0, config.maxEvents);

		return {
			active: events.length > 0,
			meaningfulData: events.map(({ startDateKey: _start, endDateKey: _end, ...event }) => event),
			model: {
				title: config.title,
				accent: config.accent,
				showAddress: config.showAddress,
				events
			},
			nextEvaluationAt: new Date(now.getTime() + 60 * 60 * 1000)
		};
	},
	render(model) {
		const layout = layoutStack1D({
			start: 16,
			length: 448,
			gap: 8,
			items: [
				{ id: 'header', basis: 54 },
				...model.events.map((event) => ({ id: event.id, grow: 1 }))
			]
		});
		const header = layout[0];
		const eventBoxes = layout.slice(1);
		const rows = model.events
			.map((event, index) => {
				const box = eventBoxes[index];
				const y = box.start;
				const date = formatDateRange(event);
				const [titleLineOne, titleLineTwo] = wrapTitle(event.title, 45);
				const address = [event.postalCode, event.street].filter(Boolean).join(' ');
				const detail = model.showAddress
					? [event.district, address].filter(Boolean).join(' · ')
					: event.district;
				const timing = truncate(date.range.replaceAll('\n', ' · '), 60);
				const detailY = titleLineTwo ? 64 : 44;
				const timingY = titleLineTwo ? 82 : 64;
				return `
					<g transform="translate(0 ${y.toFixed(2)})">
						<rect x="116" y="0" width="660" height="${box.size.toFixed(2)}" rx="8" fill="url(#tone-${index % 2 === 0 ? 'light' : 'medium'})"/>
						<rect x="122" y="5" width="648" height="${(box.size - 10).toFixed(2)}" rx="5" fill="white"/>
						<circle cx="88" cy="${(box.size / 2).toFixed(2)}" r="8" fill="url(#marker-tone)" stroke="${timelineColor}" stroke-width="2"/>
						<text x="24" y="35" font-family="sans-serif" font-size="31" font-weight="700" fill="black">${escapeXml(date.day)}</text>
						<text x="24" y="57" font-family="sans-serif" font-size="16" font-weight="700" fill="black">${escapeXml(date.month)}</text>
						<text x="130" y="24" font-family="sans-serif" font-size="23" font-weight="700" fill="black">${escapeXml(titleLineOne)}</text>
						${titleLineTwo ? `<text x="130" y="46" font-family="sans-serif" font-size="23" font-weight="700" fill="black">${escapeXml(titleLineTwo)}</text>` : ''}
						<text x="130" y="${detailY}" font-family="sans-serif" font-size="16" font-weight="700" fill="black">${escapeXml(truncate(detail, 62))}</text>
						<text x="130" y="${timingY}" font-family="sans-serif" font-size="15" font-weight="600" fill="black">${escapeXml(timing)}</text>
					</g>`;
			})
			.join('');

		return Buffer.from(`<svg width="800" height="480" viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<pattern id="header-dots" width="8" height="8" patternUnits="userSpaceOnUse">
					<rect width="8" height="8" fill="white"/>
					<rect x="1" y="1" width="2" height="2" fill="${timelineColor}"/>
					<rect x="5" y="5" width="2" height="2" fill="${timelineColor}"/>
					<rect x="6" y="2" width="1" height="1" fill="${model.accent}"/>
				</pattern>
				<pattern id="tone-light" width="12" height="12" patternUnits="userSpaceOnUse">
					<rect width="12" height="12" fill="white"/>
					<rect x="2" y="2" width="1" height="1" fill="${timelineColor}"/>
					<rect x="8" y="8" width="1" height="1" fill="${timelineColor}"/>
					<rect x="8" y="2" width="1" height="1" fill="${model.accent}"/>
				</pattern>
				<pattern id="tone-medium" width="12" height="12" patternUnits="userSpaceOnUse">
					<rect width="12" height="12" fill="white"/>
					<rect x="2" y="2" width="2" height="2" fill="${timelineColor}"/>
					<rect x="8" y="8" width="2" height="2" fill="${timelineColor}"/>
					<rect x="8" y="2" width="1" height="1" fill="${model.accent}"/>
					<rect x="2" y="8" width="1" height="1" fill="${model.accent}"/>
				</pattern>
				<pattern id="marker-tone" width="4" height="4" patternUnits="userSpaceOnUse">
					<rect width="4" height="4" fill="white"/>
					<rect width="2" height="2" fill="${timelineColor}"/>
					<rect x="2" y="2" width="2" height="2" fill="${timelineColor}"/>
					<rect x="2" y="0" width="1" height="1" fill="${model.accent}"/>
					<rect x="3" y="1" width="1" height="1" fill="${model.accent}"/>
				</pattern>
			</defs>
			<rect width="800" height="480" fill="white"/>
			<rect x="16" y="${header.start}" width="768" height="${header.size}" rx="9" fill="url(#header-dots)"/>
			<rect x="31" y="${header.start + 8}" width="738" height="${header.size - 16}" rx="5" fill="white"/>
			<text x="48" y="${header.start + 39}" font-family="sans-serif" font-size="31" font-weight="700" fill="black">${escapeXml(model.title)}</text>
			<line x1="88" y1="${eventBoxes[0].start}" x2="88" y2="${eventBoxes[eventBoxes.length - 1].end}" stroke="${timelineColor}" stroke-width="2" stroke-dasharray="2 6"/>
			${rows}
		</svg>`);
	}
};
