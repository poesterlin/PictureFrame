// worker instance
export const getWorkerInstance =  () => new ComlinkWorker<typeof import("./dithering-worker")>(
    new URL("./dithering-worker", import.meta.url)
);
