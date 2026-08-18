import { encodeImageAsFrame, framePixelsToPng } from '$lib/server/frame-image';
import { hashPluginValue } from './hash';
import { getContentPlugin } from './registry';

export type PluginPreviewResult =
	| {
			active: false;
			pluginKey: string;
			meaningfulHash: string;
	  }
	| {
			active: true;
			pluginKey: string;
			meaningfulHash: string;
			sourceImage: Buffer;
			png: Buffer;
			artifact: Buffer;
	  };

type RenderPluginPreviewInput = {
	pluginKey: string;
	input: unknown;
	config?: unknown;
	now?: Date;
};

export async function renderPluginPreview(
	previewInput: RenderPluginPreviewInput
): Promise<PluginPreviewResult> {
	const plugin = getContentPlugin(previewInput.pluginKey);
	if (!plugin) {
		throw new Error(`Unknown plugin: ${previewInput.pluginKey}`);
	}

	const config = plugin.configSchema.parse(previewInput.config ?? {});
	const normalizedData = plugin.normalize(previewInput.input);
	const evaluation = await plugin.evaluate(normalizedData, {
		config,
		now: previewInput.now ?? new Date()
	});
	const meaningfulHash = hashPluginValue(evaluation.meaningfulData);

	if (!evaluation.active) {
		return {
			active: false,
			pluginKey: plugin.key,
			meaningfulHash
		};
	}
	if (evaluation.model === undefined) {
		throw new Error('Active plugin did not provide a render model');
	}

	const renderedImage = await plugin.render(evaluation.model, { config });
	const encodedFrame = await encodeImageAsFrame(renderedImage);
	const png = await framePixelsToPng(encodedFrame.indexedPixels);

	return {
		active: true,
		pluginKey: plugin.key,
		meaningfulHash,
		sourceImage: Buffer.from(renderedImage),
		png,
		artifact: encodedFrame.artifact
	};
}
