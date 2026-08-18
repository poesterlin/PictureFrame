import type { z } from 'zod';

export type PluginEvaluation<Model> = {
	active: boolean;
	meaningfulData: unknown;
	model?: Model;
	nextEvaluationAt?: Date;
};

export type PluginEvaluationContext<Config> = {
	config: Config;
	now: Date;
};

export type PluginRenderContext<Config> = {
	config: Config;
};

export type ContentPlugin<Config, Data, Model> = {
	key: string;
	label: string;
	version: number;
	configSchema: z.ZodType<Config>;
	fetchInput?(endpointUrl: string): Promise<unknown>;
	normalize(input: unknown): Data;
	evaluate(
		data: Data,
		context: PluginEvaluationContext<Config>
	): PluginEvaluation<Model> | Promise<PluginEvaluation<Model>>;
	render(model: Model, context: PluginRenderContext<Config>): Uint8Array | Promise<Uint8Array>;
};

export type AnyContentPlugin = ContentPlugin<any, any, any>;
