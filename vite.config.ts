import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';
import { comlink } from "vite-plugin-comlink";

const config: UserConfig = {
	plugins: [comlink(), sveltekit()],
	worker: {
		plugins: [comlink()],
	},
	optimizeDeps: {
		include: ['lodash.get', 'lodash.isequal', 'lodash.clonedeep']
	}
};

export default config;
