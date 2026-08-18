export type LayoutItem1D = {
	id: string;
	basis?: number;
	grow?: number;
};

export type LayoutBox1D = {
	id: string;
	start: number;
	size: number;
	end: number;
};

type LayoutStack1DOptions = {
	start: number;
	length: number;
	gap?: number;
	items: LayoutItem1D[];
};

/** Distributes fixed and growing items along one axis, similar to a small flex column. */
export function layoutStack1D(options: LayoutStack1DOptions): LayoutBox1D[] {
	if (options.items.length === 0) return [];
	const gap = Math.max(0, options.gap ?? 0);
	const totalGap = gap * (options.items.length - 1);
	const totalBasis = options.items.reduce((sum, item) => sum + Math.max(0, item.basis ?? 0), 0);
	const totalGrow = options.items.reduce((sum, item) => sum + Math.max(0, item.grow ?? 0), 0);
	const freeSpace = Math.max(0, options.length - totalGap - totalBasis);
	let cursor = options.start;

	return options.items.map((item) => {
		const basis = Math.max(0, item.basis ?? 0);
		const grow = Math.max(0, item.grow ?? 0);
		const size = basis + (totalGrow > 0 ? (freeSpace * grow) / totalGrow : 0);
		const box = { id: item.id, start: cursor, size, end: cursor + size };
		cursor = box.end + gap;
		return box;
	});
}
