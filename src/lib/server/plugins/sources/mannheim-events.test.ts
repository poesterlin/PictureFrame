import { describe, expect, test } from 'bun:test';
import { parseMannheimEventsPage } from './mannheim-events';

describe('Mannheim event source', () => {
	test('parses official calendar teaser markup', () => {
		const events = parseMannheimEventsPage(`<li class="teaser-list__item"><div>
			<h3><a href="/de/veranstaltung/test" hreflang="de">Jazz &amp; More</a></h3>
			<svg><use xlink:href="#icon-calendar"></use></svg> 18.08.2026
			<svg><use xlink:href="#icon-clock"></use></svg> 20:00
			<span class="organization">Alte Feuerwache</span>
			<span class="address-line1">Brückenstraße 2</span>
			<span class="postal-code">68167</span>
		</div></li>`);

		expect(events).toEqual([
			expect.objectContaining({
				title: 'Jazz & More',
				date: '18.08.2026',
				time: '20:00',
				venue: 'Alte Feuerwache',
				address: '68167 Brückenstraße 2'
			})
		]);
	});
});
