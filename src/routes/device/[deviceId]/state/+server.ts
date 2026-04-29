import type { RequestHandler } from './$types';
import { getDeviceBus } from '../../../../../realtime/device-bus.js';

const bus = getDeviceBus();

export const GET: RequestHandler = async ({ params }) => {
	const state = bus.getLastState(params.deviceId);
	return new Response(JSON.stringify({ deviceId: params.deviceId, state }), {
		headers: { 'content-type': 'application/json' }
	});
};
