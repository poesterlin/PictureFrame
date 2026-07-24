import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const WIDTH = 800;
const HEIGHT = 480;
const HEADER_SIZE = 8;
const EXPECTED_SIZE = HEADER_SIZE + WIDTH * HEIGHT;
const ORANGE = 6;
const RED = 4;
const YELLOW = 5;

function validateFrame(frame: Buffer, filePath: string) {
	if (frame.length !== EXPECTED_SIZE) {
		throw new Error(`${basename(filePath)}: expected ${EXPECTED_SIZE} bytes, got ${frame.length}`);
	}
	if (frame.subarray(0, 4).toString('ascii') !== 'PF7A') {
		throw new Error(`${basename(filePath)}: invalid PF7A magic`);
	}
	if (frame.readUInt16LE(4) !== WIDTH || frame.readUInt16LE(6) !== HEIGHT) {
		throw new Error(`${basename(filePath)}: expected ${WIDTH}x${HEIGHT}`);
	}
}

async function main() {
	const directory = process.argv[2];
	const write = process.argv.includes('--write');
	if (!directory) {
		throw new Error('usage: bun scripts/convert-pf7a-orange.ts <directory> [--write]');
	}

	const names = (await readdir(directory)).filter((name) => name.endsWith('.pf7a')).sort();
	let changedFiles = 0;
	let changedPixels = 0;

	for (const name of names) {
		const filePath = join(directory, name);
		const frame = await readFile(filePath);
		validateFrame(frame, filePath);

		let filePixels = 0;
		for (let pixelIndex = 0; pixelIndex < WIDTH * HEIGHT; pixelIndex++) {
			const offset = HEADER_SIZE + pixelIndex;
			if (frame[offset] !== ORANGE) {
				continue;
			}
			const x = pixelIndex % WIDTH;
			const y = Math.floor(pixelIndex / WIDTH);
			frame[offset] = ((x ^ y) & 1) === 0 ? RED : YELLOW;
			filePixels++;
		}

		if (filePixels === 0) {
			continue;
		}
		changedFiles++;
		changedPixels += filePixels;
		if (write) {
			await copyFile(filePath, `${filePath}.bak`);
			await writeFile(filePath, frame);
		}
	}

	console.log(
		`${write ? 'converted' : 'would convert'} ${changedPixels} orange pixels in ` +
			`${changedFiles} of ${names.length} PF7A files`
	);
	if (!write) {
		console.log('dry run only; pass --write to create .bak files and replace the originals');
	}
}

await main();
