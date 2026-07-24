export type context2d = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
export type canvasImage = ImageBitmap | HTMLImageElement;
export type color = [number, number, number];
export const palette: color[] = [
	[255, 255, 255],
	[0, 0, 0],
	[255, 0, 0],
	[0, 255, 0],
	[0, 0, 255],
	[255, 255, 0],
	[100, 81, 116]
];

export interface DrawingOptions {
	fill: boolean;
	overlayName: string;
	diff: { x: number; y: number };
	brightness: number;
	saturation: number;
	contrastMode: boolean;
	context?: context2d;
	quick?: boolean;
	clear: boolean;
}

function byteIdx(x: number, y: number) {
	return 4 * x + 4 * y * 800;
}

export function atkinsonDither(
	data: Uint8ClampedArray,
	palette: color[],
	w: number,
	h: number,
	atkinson = false
) {
	const out = new Uint8ClampedArray(data);

	let neighbors = [];
	let ratio = 16;

	if (atkinson) {
		ratio = 8;
		neighbors = [
			// Atkinson
			[byteIdx(1, 0), 1],
			[byteIdx(0, 1), 1],
			[byteIdx(-1, 1), 1],
			[byteIdx(1, 1), 1],
			[byteIdx(2, 0), 1],
			[byteIdx(0, 2), 1]
		];
	} else {
		neighbors = [
			// Floyd-Steinberg
			[byteIdx(1, -1), 3],
			[byteIdx(1, 0), 5],
			[byteIdx(1, 1), 1],
			[byteIdx(0, 1), 7]
		];
	}

	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1) {
			const pix = byteIdx(x, y);

			const original = [data[pix], data[pix + 1], data[pix + 2]] as color;
			const palletCol = approximateColor(original, palette);
			const error = original.map((val, i) => (val - palletCol[i]) / ratio);

			neighbors.forEach(([neighbor, factor]) => {
				add(data, pix + neighbor, error[0] * factor);
				add(data, pix + neighbor + 1, error[1] * factor);
				add(data, pix + neighbor + 2, error[2] * factor);
			});

			set(out, pix, palletCol);
		}
	}
	return out;
}

export function add(buffer: Uint8ClampedArray, address: number, value: number) {
	buffer[address] += value;
}

export function set(buffer: Uint8ClampedArray, address: number, value: color) {
	buffer[address] = value[0];
	buffer[address + 1] = value[1];
	buffer[address + 2] = value[2];
}

export function approximateColor(color: color, palette: color[]): color {
	let idx = 0;
	let minDist = Infinity;
	palette.forEach((paletteColor, i) => {
		const dist = colorDistance(paletteColor, color);
		if (dist < minDist) {
			idx = i;
			minDist = dist;
		}
	});

	return palette[idx];
}

export function colorDistance(a: color, b: color) {
	return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2));
}

export function changeBrightness(input: Uint8ClampedArray, brightness: number) {
	for (let index = 0; index < input.length; index++) {
		input[index] *= brightness;
	}
	return input;
}

export function changeSaturation(data: Uint8ClampedArray, value: number) {
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];

		const gray = 0.2989 * r + 0.587 * g + 0.114 * b; // weights from CCIR 601 spec
		data[i] = -gray * value + r * (1 + value) * 1.1;
		data[i + 1] = -gray * value + g * (1 + value);
		data[i + 2] = -gray * value + b * (1 + value);
	}
}

export function drawImageScaled(
	context: context2d,
	img: canvasImage,
	diff: { x: number; y: number },
	type: 'cover' | 'contain'
) {
	const imgRatio = img.height / img.width;
	const winRatio = 480 / 800;
	if ((imgRatio < winRatio && type === 'contain') || (imgRatio >= winRatio && type === 'cover')) {
		const h = 800 * imgRatio;
		context.drawImage(img, 0, (480 - h) / 2 - diff.y, 800, h);
	}
	if ((imgRatio >= winRatio && type === 'contain') || (imgRatio < winRatio && type === 'cover')) {
		const w = (800 * winRatio) / imgRatio;
		context.drawImage(img, (800 - w) / 2 - diff.x, 0, w, 480);
	}
}

export function drawNameTag(name: string, context: context2d) {
	if (!context) {
		return;
	}

	context.fillStyle = 'black';
	context.textAlign = 'right';
	context.textBaseline = 'bottom';
	context.font = '18px sans-serif';

	const nameWidth = context.measureText(name).width;
	context.fillRect(800 - nameWidth - 10, 480 - 25, nameWidth + 10, 25);

	context.fillStyle = 'white';
	context.fillText(name, 800 - 3, 480 - 3);
}

export async function doStuff(
	context: context2d,
	image: canvasImage,
	imgData: ImageData,
	options: DrawingOptions
) {
	const { fill, overlayName, brightness, saturation, contrastMode, diff } = options;

	if (options.clear) {
		context.clearRect(0, 0, 800, 480);
	}

	drawImageScaled(context, image, diff, fill ? 'cover' : 'contain');
	drawNameTag(overlayName, context);

	imgData = context.getImageData(0, 0, 800, 480);

	const adjusted = changeBrightness(imgData.data, brightness);
	changeSaturation(adjusted, saturation == -0.4 ? -1 : saturation);
	return atkinsonDither(adjusted, palette, 800, 480, contrastMode);
}
