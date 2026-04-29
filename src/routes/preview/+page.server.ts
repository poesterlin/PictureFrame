import type { PageServerLoad } from './$types';
import { listArtifactKeys } from '../../../realtime/frame-storage.js';


export const prerender = false;

export const load: PageServerLoad = async () => {
	const keys = await listArtifactKeys();
	keys.sort().reverse();
	return { keys };
};
