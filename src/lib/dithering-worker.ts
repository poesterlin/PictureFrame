import { doStuff, type context2d, type DrawingOptions } from '$lib/dither';
import { expose } from 'comlink';

const canvas = new OffscreenCanvas(800, 480);
const context = canvas.getContext('2d', { willReadFrequently: true }) as context2d;

let imgBlob: ImageBitmap | undefined;

const workerApi = {
	setImg: async (file: File) => {
		if (imgBlob) {
			imgBlob.close();
		}

		imgBlob = await createImageBitmap(file, {});
		if (imgBlob.width > imgBlob.height) {
			imgBlob = await createImageBitmap(file, {
				resizeHeight: Math.min(480, imgBlob.height)
			});
		} else {
			imgBlob = await createImageBitmap(file, {
				resizeWidth: Math.min(800, imgBlob.width)
			});
		}
	},

	ditherImg: async (imgData: ImageData, options: DrawingOptions) => {
		if (!imgBlob) {
			throw new Error('set image first');
		}

		return doStuff(context, imgBlob, imgData, options);
	}
};

export type DitheringWorkerApi = typeof workerApi;

expose(workerApi);
