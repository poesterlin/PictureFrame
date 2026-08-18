import { create } from 'qrcode';

type QrSvgOptions = {
	moduleSize?: number;
	margin?: number;
};

export function qrSvg(text: string, x: number, y: number, options: QrSvgOptions = {}) {
	const moduleSize = options.moduleSize ?? 3;
	const margin = options.margin ?? 4;
	const qr = create(text, { errorCorrectionLevel: 'L' });
	const size = qr.modules.size;
	const origin = margin * moduleSize;
	const pixel = (size + margin * 2) * moduleSize;

	const runs: string[] = [];
	for (let row = 0; row < size; row += 1) {
		let col = 0;
		while (col < size) {
			if (!qr.modules.get(row, col)) {
				col += 1;
				continue;
			}
			let end = col;
			while (end < size && qr.modules.get(row, end)) end += 1;
			const runX = origin + col * moduleSize;
			const runY = origin + row * moduleSize;
			const runWidth = (end - col) * moduleSize;
			runs.push(`M${runX} ${runY}h${runWidth}v${moduleSize}h-${runWidth}z`);
			col = end;
		}
	}

	return `<g transform="translate(${x} ${y})">
			<rect width="${pixel}" height="${pixel}" rx="6" fill="white"/>
			<path fill="#000000" d="${runs.join('')}"/>
		</g>`;
}
