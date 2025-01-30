import { doStuff, type canvasImage, type DrawingOptions } from '$lib/dither';


export const native = {

    ditherImg: async (imgBlob: canvasImage, imgData: ImageData, options: DrawingOptions) => {
        return doStuff(options.context!, imgBlob, imgData, options)
    }
} 