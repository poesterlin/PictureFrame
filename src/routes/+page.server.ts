import { isAdminUser } from '$lib/server/admin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const isAdmin = locals.user ? isAdminUser(locals.user) : false;

	return {
		user: locals.user,
		isAdmin
	};
};
