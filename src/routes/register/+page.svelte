<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { fade } from 'svelte/transition';
 	import type { ActionData } from './$types';

	export let form: ActionData;
</script>

<div class="background">
	<div class="card">
		<div class="content">
			<h2>Register</h2>

			<form method="POST" action="?/register" use:enhance>
				<div>
					<label for="inviteCode">Invite code</label>
					<input
						type="text"
						id="inviteCode"
						name="inviteCode"
						placeholder="ABCD-EFGH-JKLM"
						required
					/>
				</div>

				<div>
					<label for="username">Username</label>
					<input
						type="text"
						id="username"
						name="username"
						placeholder="Pick a username"
						required
					/>
				</div>

				<div>
					<label for="password">Password</label>
					<input
						type="password"
						id="password"
						name="password"
						placeholder="........"
						required
					/>
				</div>

				{#if form?.message}
					<p class="message" transition:fade>
						{form.message}
					</p>
				{/if}

				<input type="hidden" name="redirect" value={$page.url.search} />

				<button type="submit">Register</button>
			</form>

			<p class="footer-copy">
				Already have an account?
				<a href="/login{$page.url.search}">Log in here!</a>
			</p>
		</div>
		<div class="meta">Made with <span aria-hidden="true">&hearts;</span> for awesome people!</div>
	</div>
</div>

<style>
	h2 {
		view-transition-name: login-header;
	}

	.card {
		view-transition-name: login-card;
		max-width: 95vw;
	}

	.background {
		view-transition-name: login-background;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 1rem;
		background: #f8fafc;
	}

	.card {
		width: min(100%, 28rem);
		overflow: hidden;
		border-radius: 0.5rem;
		background: #fff;
		box-shadow: 0 20px 35px rgba(0, 0, 0, 0.14);
	}

	.content {
		padding: 2rem 1.5rem;
	}

	h2 {
		margin: 0 0 1.5rem;
		text-align: center;
		font-size: 1.9rem;
		font-weight: 600;
	}

	form {
		display: grid;
		gap: 1rem;
	}

	label {
		display: block;
		margin: 0 0 0.45rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: #374151;
	}

	input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		font: inherit;
		line-height: 1.4;
		color: #1f2937;
		background: #fff;
		border: 1px solid #d1d5db;
		border-radius: 0.35rem;
	}

	button {
		width: 100%;
		padding: 0.65rem 0.9rem;
		font: inherit;
		font-weight: 700;
		color: #fff;
		background: #64748b;
		border: none;
		border-radius: 0.35rem;
	}

	.message {
		margin: 0;
		text-align: center;
		font-size: 0.9rem;
		color: #f43f5e;
	}

	.footer-copy {
		margin: 1rem 0 0;
		text-align: center;
		font-size: 0.95rem;
		color: #4b5563;
	}

	a {
		color: #8b5cf6;
		text-decoration: none;
	}

	.meta {
		padding: 0.7rem 1rem;
		text-align: center;
		font-size: 0.75rem;
		color: #6b7280;
		background: #f1f5f9;
	}
</style>
