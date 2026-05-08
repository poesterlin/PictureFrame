import type { RouteId } from '$app/types';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import type { z, ZodObject } from 'zod';

export function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	const id = encodeBase32LowerCase(bytes);
	return id;
}

export function validateUsername(username: unknown): username is string {
	return typeof username === 'string' && username.length >= 3 && username.length <= 31;
}

export function validatePassword(password: unknown): password is string {
	return typeof password === 'string' && password.length >= 6 && password.length <= 255;
}

export function assert(condition: any, message: string): asserts condition;
export function assert(condition: any, code: number, message: string): asserts condition;
export function assert(condition: any, code: number | string, message?: string): asserts condition {
	if (!condition && typeof code === 'number') {
		error(code, message);
	}

	if (!condition) {
		throw new Error(message || 'Assertion failed');
	}
}

export type MaybePromise<T> = T | Promise<T>;
export type FormAction<
	T,
	Params extends Record<string, never> = Record<string, never>,
	OutputData extends Record<string, any> | void = Record<string, any> | void,
> = (event: RequestEvent<Params, RouteId>, form: T) => MaybePromise<OutputData>;

export function validateForm<T extends ZodObject<any>, Form extends z.infer<T>>(
	validator: T,
	action: FormAction<Form>
) {
	return async function (event: any) {
		const form = await event.request.formData();

		const data = Object.fromEntries(form);
		const result = validator.safeParse(data);

		if (!result.success) {
			return fail(400, { errors: result.error.type, message: 'Invalid form data' });
		}

		return action(event, result.data as Form);
	};
}

type RequiredProperty<T> = { [P in keyof T]: Required<NonNullable<T[P]>> };

export function validateAuth(events: any): RequiredProperty<App.Locals> | never {
	const { request, locals } = events;

	const url = new URL(request.url);
	const redirectUrl = '/login?redirect=' + encodeURIComponent(url.pathname + url.search);

	if (!locals.session) {
		redirect(302, redirectUrl);
	}

	const now = Date.now();
	if (now >= locals.session.expiresAt.getTime()) {
		redirect(302, redirectUrl);
	}

	locals.user = { id: locals.user.id, username: locals.user.username };

	return locals;
}
