import { authenticateFrameRequest, type AuthenticatedFrame } from '$lib/server/device/auth';
import { error, type RequestEvent } from '@sveltejs/kit';

export async function requireFrameAuth(event: RequestEvent): Promise<AuthenticatedFrame> {
	const auth = await authenticateFrameRequest(event.request.headers);
	if (!auth) {
		error(401, 'Unauthorized');
	}
	return auth;
}
