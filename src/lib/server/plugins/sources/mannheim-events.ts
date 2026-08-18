export const MANNHEIM_EVENTS_URL = 'https://www.mannheim.de/de/veranstaltungen';

export type MannheimEventOccurrence = {
	id: string;
	title: string;
	date: string;
	time: string;
	venue: string;
	address: string;
	url: string;
};

function decodeHtml(value: string): string {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#039;', "'")
		.replaceAll('&apos;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function matchText(block: string, pattern: RegExp): string {
	return decodeHtml(pattern.exec(block)?.[1] ?? '');
}

export function parseMannheimEventsPage(html: string): MannheimEventOccurrence[] {
	return html
		.split('<li class="teaser-list__item">')
		.slice(1)
		.map((block) => {
			const link = /<h3><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/.exec(block);
			const date = /#icon-calendar[\s\S]*?<\/svg>\s*(\d{2}\.\d{2}\.\d{4})/.exec(block)?.[1];
			if (!link || !date) return null;
			const path = decodeHtml(link[1]);
			const time = /#icon-clock[\s\S]*?<\/svg>\s*(\d{2}:\d{2})/.exec(block)?.[1] ?? '';
			const venue = matchText(block, /<span class="organization">([\s\S]*?)<\/span>/);
			const street = matchText(block, /<span class="address-line1">([\s\S]*?)<\/span>/);
			const postalCode = matchText(block, /<span class="postal-code">([\s\S]*?)<\/span>/);

			return {
				id: `${path}:${date}:${time}`,
				title: decodeHtml(link[2]),
				date,
				time,
				venue,
				address: [postalCode, street].filter(Boolean).join(' '),
				url: new URL(path, MANNHEIM_EVENTS_URL).toString()
			};
		})
		.filter((event): event is MannheimEventOccurrence => event !== null);
}

function formatGermanDate(date: Date): string {
	return new Intl.DateTimeFormat('de-DE', {
		timeZone: 'Europe/Berlin',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	}).format(date);
}

export async function fetchMannheimEventOccurrences(
	now = new Date(),
	daysAhead = 30,
	maxPages = 12
): Promise<MannheimEventOccurrence[]> {
	const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
	const base = new URL(MANNHEIM_EVENTS_URL);
	base.searchParams.set('date_from', formatGermanDate(now));
	base.searchParams.set('date_to', formatGermanDate(end));

	const pages = await Promise.all(
		Array.from({ length: maxPages }, async (_, page) => {
			const url = new URL(base);
			url.searchParams.set('page', String(page));
			const response = await fetch(url, {
				headers: { accept: 'text/html', 'user-agent': 'PictureFrame/1.0' },
				signal: AbortSignal.timeout(8_000)
			});
			if (!response.ok) throw new Error(`Mannheim calendar returned HTTP ${response.status}`);
			return parseMannheimEventsPage(await response.text());
		})
	);

	const unique = new Map<string, MannheimEventOccurrence>();
	for (const event of pages.flat()) unique.set(event.id, event);
	return [...unique.values()];
}
