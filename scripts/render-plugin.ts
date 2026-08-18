import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { listContentPlugins } from '../src/lib/server/plugins/registry';
import { renderPluginPreview } from '../src/lib/server/plugins/preview';

type Options = {
	pluginKey: string;
	input: string;
	config: string;
	output: string;
	pf7a?: string;
	source?: string;
	at?: Date;
};

function usage() {
	return `Usage:
  bun run plugin:render -- [plugin] [options]

Options:
  --input <path-or-url>   JSON input (default: scripts/plugin-fixtures/<plugin>-input.json)
  --config <path-or-json> Plugin config (default: scripts/plugin-fixtures/<plugin>-config.json)
  --output <path>         PNG output (default: data/plugin-previews/<plugin>.png)
  --pf7a <path>           Also write the display artifact
  --source <path>         Also write the plugin's source image (for example SVG)
  --at <iso-date>         Fixed evaluation time for time-sensitive plugins
  --list                  List registered plugins
  --help                  Show this help`;
}

function valueAfter(args: string[], index: number, option: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith('--')) {
		throw new Error(`${option} requires a value`);
	}
	return value;
}

function parseArgs(args: string[]): Options | null {
	if (args.includes('--help')) {
		console.log(usage());
		return null;
	}
	if (args.includes('--list')) {
		for (const plugin of listContentPlugins()) {
			console.log(`${plugin.key}\t${plugin.label}`);
		}
		return null;
	}

	const hasExplicitPlugin = Boolean(args[0] && !args[0].startsWith('--'));
	const pluginKey = hasExplicitPlugin ? args[0] : 'square';
	const options: Options = {
		pluginKey,
		input: `scripts/plugin-fixtures/${pluginKey}-input.json`,
		config: `scripts/plugin-fixtures/${pluginKey}-config.json`,
		output: `data/plugin-previews/${pluginKey}.png`
	};

	for (let index = hasExplicitPlugin ? 1 : 0; index < args.length; index += 1) {
		const argument = args[index];
		switch (argument) {
			case '--input':
				options.input = valueAfter(args, index, argument);
				index += 1;
				break;
			case '--config':
				options.config = valueAfter(args, index, argument);
				index += 1;
				break;
			case '--output':
				options.output = valueAfter(args, index, argument);
				index += 1;
				break;
			case '--pf7a':
				options.pf7a = valueAfter(args, index, argument);
				index += 1;
				break;
			case '--source':
				options.source = valueAfter(args, index, argument);
				index += 1;
				break;
			case '--at': {
				const rawDate = valueAfter(args, index, argument);
				const date = new Date(rawDate);
				if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${rawDate}`);
				options.at = date;
				index += 1;
				break;
			}
			default:
				throw new Error(`Unknown argument: ${argument}`);
		}
	}

	return options;
}

async function loadJson(source: string): Promise<unknown> {
	if (source.startsWith('http://') || source.startsWith('https://')) {
		const response = await fetch(source, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(10_000)
		});
		if (!response.ok) throw new Error(`Input URL returned HTTP ${response.status}`);
		return response.json();
	}

	const trimmed = source.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		return JSON.parse(trimmed);
	}
	return Bun.file(resolve(source)).json();
}

async function writeOutput(path: string, contents: Uint8Array) {
	const absolutePath = resolve(path);
	await mkdir(dirname(absolutePath), { recursive: true });
	await Bun.write(absolutePath, contents);
	return absolutePath;
}

async function main() {
	const options = parseArgs(Bun.argv.slice(2));
	if (!options) return;

	const [input, config] = await Promise.all([loadJson(options.input), loadJson(options.config)]);
	const result = await renderPluginPreview({
		pluginKey: options.pluginKey,
		input,
		config,
		now: options.at
	});

	if (!result.active) {
		console.log(`Plugin ${result.pluginKey} is inactive; no image was written.`);
		return;
	}

	const pngPath = await writeOutput(options.output, result.png);
	console.log(`PNG: ${pngPath}`);
	if (options.pf7a) {
		const artifactPath = await writeOutput(options.pf7a, result.artifact);
		console.log(`PF7A: ${artifactPath}`);
	}
	if (options.source) {
		const sourcePath = await writeOutput(options.source, result.sourceImage);
		console.log(`Source: ${sourcePath}`);
	}
	console.log(`Meaningful hash: ${result.meaningfulHash}`);
}

await main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	console.error(usage());
	process.exitCode = 1;
});
