import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { validateForm, validatePassword, validateUsername } from '$lib/server/util';
import { hash } from '@node-rs/argon2';
import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

function isLocalRequest(hostname: string) {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export const load: PageServerLoad = async (event) => {
	if (!isLocalRequest(event.url.hostname)) {
		error(404, 'Not found');
	}

	return {};
};

export const actions: Actions = {
	reset: validateForm(
		z.object({
			username: z.string(),
			password: z.string(),
			confirmPassword: z.string()
		}),
		async (event, form) => {
			if (!isLocalRequest(event.url.hostname)) {
				return fail(403, { message: 'This reset page is only available on localhost.' });
			}

			const { username, password, confirmPassword } = form;

			if (!validateUsername(username)) {
				return fail(400, { message: 'Please enter a valid username.' });
			}

			if (!validatePassword(password)) {
				return fail(400, { message: 'Password must be between 6 and 255 characters.' });
			}

			if (password !== confirmPassword) {
				return fail(400, { message: 'Passwords do not match.' });
			}

			const results = await db
				.select()
				.from(table.usersTable)
				.where(eq(table.usersTable.username, username));

			const existingUser = results.at(0);
			if (!existingUser) {
				return fail(400, { message: 'User not found.' });
			}

			const passwordHash = await hash(password, {
				memoryCost: 19456,
				timeCost: 2,
				outputLen: 32,
				parallelism: 1
			});

			await db.update(table.usersTable).set({ passwordHash }).where(eq(table.usersTable.id, existingUser.id));
			await db.delete(table.sessionTable).where(eq(table.sessionTable.userId, existingUser.id));

			return {
				success: true,
				message: 'Password reset. You can now log in with the new password.'
			};
		}
	)
};
