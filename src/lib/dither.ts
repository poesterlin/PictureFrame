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
	[255, 128, 0]
];

export interface DrawingOptions {
	fill: boolean,
	overlayName: string,
	diff: { x: number, y: number },
	brightness: number,
	saturation: number,
	contrastMode: boolean,
	context?: context2d;
	clear: boolean;
}


export function optimizeForScreen(data: Uint8ClampedArray, threshold: number) {
	let totalReds = 0;

	for (let x = 0; x < 800; x += 1) {
		let reds = 0;
		for (let y = 0; y < 480; y += 1) {
			const pix = byteIdx(x, y);

			if (data[pix] > 200 && data[pix + 1] > 120 && data[pix + 2] < 200) {
				reds += 1;
			}

			if (reds > threshold) {
				for (let y1 = 0; y1 + y < 480; y1 += 1) {
					const absY = y1 + y;
					const i = byteIdx(x, absY);

					const r = data[i];
					const g = data[i + 1];
					const b = data[i + 2];

					if (r > 120 && g > 80 && g < 200 && b < 200) {
						reds += 1;
						const value = Math.max(-y1 / 350, -0.5);
						const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b; // weights from CCIR 601 spec

						data[i] = -gray * value + r * (1 + value) + 15;
						data[i + 1] = -gray * value + g * (1 + value) + 15;
						data[i + 2] = -gray * -value + b * (1 + -value) + 15;
					}
				}
				totalReds += reds;
				break;
			}
		}
	}

	if (totalReds / (480 * 800) < 0.25) {
		return;
	}

	const cutoff = 0.1;
	for (let i = 0; i < data.length; i += 4) {
		const [hue, saturation, lightness] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
		const inRange = hue < cutoff;
		const [r, g, b] = hsvToRgb(hue, inRange ? saturation * 1.25 : saturation, lightness);

		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
	}
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

		const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b; // weights from CCIR 601 spec
		data[i] = -gray * value + r * (1 + value) * 1.1;
		data[i + 1] = -gray * value + g * (1 + value);
		data[i + 2] = -gray * value + b * (1 + value);
	}
}


function rgbToHsv(r: number, g: number, b: number) {
	(r /= 255), (g /= 255), (b /= 255);

	const max = Math.max(r, g, b),
		min = Math.min(r, g, b);
	let h = 0;
	const v = max;

	const d = max - min;
	const s = max == 0 ? 0 : d / max;

	if (max == min) {
		h = 0;
	} else {
		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			case b:
				h = (r - g) / d + 4;
				break;
		}

		h /= 6;
	}

	return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number) {
	let r = 0,
		g = 0,
		b = 0;

	const i = Math.floor(h * 6);
	const f = h * 6 - i;
	const p = v * (1 - s);
	const q = v * (1 - f * s);
	const t = v * (1 - (1 - f) * s);

	switch (i % 6) {
		case 0:
			(r = v), (g = t), (b = p);
			break;
		case 1:
			(r = q), (g = v), (b = p);
			break;
		case 2:
			(r = p), (g = v), (b = t);
			break;
		case 3:
			(r = p), (g = q), (b = v);
			break;
		case 4:
			(r = t), (g = p), (b = v);
			break;
		case 5:
			(r = v), (g = p), (b = q);
			break;
	}

	return [r * 255, g * 255, b * 255];
}



export function drawImageScaled(context: context2d, img: canvasImage, diff: { x: number, y: number }, type: 'cover' | 'contain') {
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

export async function doStuff(context: context2d, image: canvasImage, imgData: ImageData, options: DrawingOptions) {
	const { fill, overlayName, brightness, saturation, contrastMode, diff } = options;

	if (options.clear) {
		context.clearRect(0, 0, 800, 480);
	}

	drawImageScaled(context, image, diff, fill ? 'cover' : 'contain');
	drawNameTag(overlayName, context);

	imgData = context.getImageData(0, 0, 800, 480);
	
	const adjusted = changeBrightness(imgData.data, brightness);
	changeSaturation(adjusted, saturation == -0.4 ? -1 : saturation);
	optimizeForScreen(adjusted, 80);
	
	return atkinsonDither(adjusted, palette, 800, 480, contrastMode);
}