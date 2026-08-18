import { describe, expect, test } from 'bun:test';
import { layoutStack1D } from './layout';

describe('one-dimensional plugin layout', () => {
	test('keeps fixed space and shares the remaining space between growing items', () => {
		const boxes = layoutStack1D({
			start: 10,
			length: 110,
			gap: 5,
			items: [
				{ id: 'header', basis: 20 },
				{ id: 'first', grow: 1 },
				{ id: 'second', grow: 1 }
			]
		});

		expect(boxes).toEqual([
			{ id: 'header', start: 10, size: 20, end: 30 },
			{ id: 'first', start: 35, size: 40, end: 75 },
			{ id: 'second', start: 80, size: 40, end: 120 }
		]);
	});
});
