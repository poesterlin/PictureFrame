import { z } from 'zod';
import type { ContentPlugin } from '../types';

const squareConfigSchema = z.object({
	x: z.number().int().min(0).max(799).default(310),
	y: z.number().int().min(0).max(479).default(150),
	size: z.number().int().min(1).max(480).default(180),
	fill: z.enum(['black', 'red', 'green', 'blue', 'yellow', 'orange']).default('black'),
	background: z.enum(['white', 'black']).default('white')
});

type SquareConfig = z.infer<typeof squareConfigSchema>;
type SquareModel = SquareConfig;

export const squarePlugin: ContentPlugin<SquareConfig, unknown, SquareModel> = {
	key: 'square',
	label: 'Square',
	version: 1,
	configSchema: squareConfigSchema,
	normalize(input) {
		return input;
	},
	evaluate(_data, { config }) {
		return {
			active: true,
			// The starter plugin intentionally ignores the API payload. API changes are
			// therefore not meaningful until a future plugin opts into specific fields.
			meaningfulData: {},
			model: config
		};
	},
	render(model) {
		const maxSize = Math.min(model.size, 800 - model.x, 480 - model.y);
		return Buffer.from(
			`<svg width="800" height="480" viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg">` +
				`<rect width="800" height="480" fill="${model.background}"/>` +
				`<rect x="${model.x}" y="${model.y}" width="${maxSize}" height="${maxSize}" fill="${model.fill}"/>` +
				'</svg>'
		);
	}
};
