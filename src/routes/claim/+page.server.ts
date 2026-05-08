import { claimFrameByCode } from '$lib/server/frame-claim';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		const redirectTo = encodeURIComponent(`${url.pathname}${url.search}`);
		throw redirect(302, `/login?redirect=${redirectTo}`);
	}

	return {
		prefillCode: url.searchParams.get('code')?.trim() ?? ''
	};
};

export const actions: Actions = {
	claim: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const form = await request.formData();
		const code = String(form.get('code') || '').trim();

		if (!code) {
			return fail(400, { message: 'Please enter a claim code' });
		}

		const result = await claimFrameByCode(code, locals.user.id);

		if (!result.ok) {
			if (result.reason === 'already_has_frame') {
				return fail(400, { message: 'Your account already has a frame' });
			}
			if (result.reason === 'already_claimed') {
				return fail(400, { message: 'This claim code has already been used' });
			}
			if (result.reason === 'invalid_or_expired') {
				return fail(400, { message: 'Invalid or expired claim code' });
			}
			return fail(500, { message: 'Could not claim this frame right now. Please try again.' });
		}

		throw redirect(302, '/settings');
	}
};
