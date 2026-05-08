// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		type ValidatedSessionResult = import('$lib/server/auth').SessionValidationResult;

		interface Locals {
			user: ValidatedSessionResult['user'];
			session: ValidatedSessionResult['session'];
		}

		// interface Error {}
		// interface PageData {}
		// interface Platform {}
	}
}

export {};
