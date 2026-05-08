import { wrap, type Remote } from 'comlink';
import type { DitheringWorkerApi } from './dithering-worker';

let worker: Worker | undefined;
let workerApi: Remote<DitheringWorkerApi> | undefined;

export function getWorkerInstance() {
	if (!worker || !workerApi) {
		worker = new Worker(new URL('./dithering-worker.ts', import.meta.url), { type: 'module' });
		workerApi = wrap<DitheringWorkerApi>(worker);
	}

	return workerApi;
}

export function disposeWorkerInstance() {
	if (worker) {
		worker.terminate();
	}

	worker = undefined;
	workerApi = undefined;
}
