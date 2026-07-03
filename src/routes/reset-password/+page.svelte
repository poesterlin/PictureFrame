<script lang="ts">
	import { enhance } from '$app/forms';
	import { fade } from 'svelte/transition';
	import type { ActionData } from './$types';

	export let form: ActionData;
</script>

<div class="background">
	<div class="card">
		<div class="content">
			<h2>Local Password Reset</h2>
			<p class="intro">For local recovery only. Enter your username and set a new password.</p>

			<form method="POST" action="?/reset" use:enhance>
				<div>
					<label for="username">Username</label>
					<input type="text" id="username" name="username" autocomplete="username" required />
				</div>

				<div>
					<label for="password">New password</label>
					<input
						type="password"
						id="password"
						name="password"
						autocomplete="new-password"
						required
					/>
				</div>

				<div>
					<label for="confirmPassword">Confirm new password</label>
					<input
						type="password"
						id="confirmPassword"
						name="confirmPassword"
						autocomplete="new-password"
						required
					/>
				</div>

				{#if form?.message}
					<p class="message" class:success={form?.success} transition:fade>{form.message}</p>
				{/if}

				<button type="submit">Reset password</button>
			</form>

			<p class="footer-copy">
				Back to <a href="/login">login</a>
			</p>
		</div>
	</div>
</div>

<style>
	.background {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 1rem;
	}

	.card {
		width: min(100%, 30rem);
		overflow: hidden;
		border-radius: 0.5rem;
		background: #fff;
		box-shadow: 0 20px 35px rgba(0, 0, 0, 0.14);
	}

	.content {
		padding: 2rem 1.5rem;
	}

	h2 {
		margin: 0;
		text-align: center;
		font-size: 1.6rem;
		font-weight: 600;
	}

	.intro {
		margin: 0.75rem 0 1.25rem;
		text-align: center;
		font-size: 0.95rem;
		color: #4b5563;
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
		background: #000;
		border: none;
		border-radius: 0.35rem;
	}

	.message {
		margin: 0;
		text-align: center;
		font-size: 0.9rem;
		color: #b91c1c;
	}

	.message.success {
		color: #047857;
	}

	.footer-copy {
		margin: 1rem 0 0;
		text-align: center;
		font-size: 0.95rem;
		color: #4b5563;
	}

	a {
		color: #f43f5e;
		text-decoration: none;
	}
</style>
