import * as auth from '$lib/server/auth';
import { db } from '$lib/server/db';
import { usersTable } from '$lib/server/db/schema';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login?redirect=%2Fprofile');
	}

	return {
		user: locals.user
	};
};

export const actions: Actions = {
	logout: async (event) => {
		const session = event.locals.session;
		if (!session) {
			return fail(401, { message: 'Unauthorized' });
		}

		await auth.invalidateSession(session.id);
		auth.deleteSessionTokenCookie(event);

		throw redirect(302, '/login');
	},

	deleteAccount: async (event) => {
		const user = event.locals.user;
		if (!user) {
			return fail(401, { message: 'Unauthorized' });
		}

		await db.delete(usersTable).where(eq(usersTable.id, user.id));
		auth.deleteSessionTokenCookie(event);

		throw redirect(302, '/');
	}
};
