import type { RequestHandler } from './$types';
import { getDeviceBus } from '../../../../realtime/device-bus.js';

const bus = getDeviceBus();

export const GET: RequestHandler = async () => {
	const state = bus.getLastState();
	return new Response(JSON.stringify({ state }), {
		headers: { 'content-type': 'application/json' }
	});
};
