import * as auth from '$lib/server/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { claimFrameByCode } from '$lib/server/frame-claim';
import { generateId, validateForm, validatePassword, validateUsername } from '$lib/server/util';
import { hash } from '@node-rs/argon2';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import type { RequestEvent } from './$types';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		return redirect(302, '/');
	}

	return {
		inviteCode: event.url.searchParams.get('inviteCode')?.trim() ?? ''
	};
};

export const actions: Actions = {
	register: validateForm(
		z.object({
			inviteCode: z.string().optional(),
			username: z.string(),
			password: z.string(),
			email: z.string().optional(),
			redirect: z.string().optional()
		}),
		async (event, form) => {
			const { username, password } = form;
			const inviteCode =
				form.inviteCode?.trim() ?? event.url.searchParams.get('inviteCode')?.trim() ?? '';

			if (!inviteCode) {
				return fail(400, {
					message: 'Invite code is required'
				});
			}

			if (!validateUsername(username)) {
				return fail(400, {
					message:
						'Oopsie! It looks like your username needs a little more love. Please try again! 😊'
				});
			}
			if (!validatePassword(password)) {
				return fail(400, {
					message:
						'Oopsie! It looks like your password needs a little more love. Please try again! 😊'
				});
			}

			const userId = generateId();
			const passwordHash = await hash(password, {
				memoryCost: 19456,
				timeCost: 2,
				outputLen: 32,
				parallelism: 1
			});

			try {
				await db.insert(table.usersTable).values({
					id: userId,
					createdAt: new Date(),
					lastLogin: new Date(),
					username,
					passwordHash
				});

				const claimResult = await claimFrameByCode(inviteCode, userId);
				if (!claimResult.ok) {
					await db.delete(table.usersTable).where(eq(table.usersTable.id, userId));

					if (claimResult.reason === 'already_claimed') {
						return fail(400, { message: 'This invite code has already been used' });
					}
					if (claimResult.reason === 'invalid_or_expired') {
						return fail(400, { message: 'Invalid or expired invite code' });
					}
					return fail(500, { message: 'Could not validate this invite code. Please try again.' });
				}

				const sessionToken = auth.generateSessionToken();
				const session = await auth.createSession(sessionToken, userId);
				auth.setSessionTokenCookie(event as RequestEvent, sessionToken, session.expiresAt);
			} catch {
				return fail(500, {
					message: 'Oopsie! It looks like something went wrong. Please try again! 😊'
				});
			}

			let to = '/';
			const redirectUrl = 'http://t' + form.redirect;
			try {
				const url = new URL(redirectUrl);
				to = url.searchParams.get('redirect') || '/';
			} catch {}

			return redirect(302, to);
		}
	)
};
