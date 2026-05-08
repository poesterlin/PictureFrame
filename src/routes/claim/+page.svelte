<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	let code = data.prefillCode;
</script>

<section class="claim-wrap">
	<div class="claim-card">
		<h1>Frame claimen</h1>
		<p>Gib den Claim-Code ein, den du mit deinem Geschenk erhalten hast.</p>

		<form method="POST" action="?/claim" use:enhance>
			<label for="code">Claim-Code</label>
			<input id="code" name="code" bind:value={code} placeholder="ABCD-EFGH-JKLM" required />
			<button type="submit">Frame übernehmen</button>
		</form>

		{#if form?.message}
			<p class="notice">{form.message}</p>
		{/if}
	</div>
</section>

<style>
	.claim-wrap {
		display: grid;
		place-items: center;
		padding: clamp(1rem, 4vw, 2rem);
	}

	.claim-card {
		width: min(560px, 100%);
		display: grid;
		gap: 0.75rem;
		padding: clamp(1rem, 3vw, 1.8rem);
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid rgba(15, 23, 42, 0.14);
		box-shadow: 0 24px 52px -38px rgba(0, 0, 0, 0.6);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.4rem, 4vw, 2rem);
	}

	p {
		margin: 0;
		font-size: 0.94rem;
		color: #475569;
	}

	form {
		display: grid;
		gap: 0.55rem;
	}

	label {
		font-size: 0.84rem;
		font-weight: 600;
	}

	input {
		padding: 0.68rem 0.75rem;
		font: inherit;
		font-size: 0.95rem;
		border-radius: 10px;
		border: 1px solid rgba(15, 23, 42, 0.24);
	}

	button {
		font: inherit;
		padding: 0.72rem 0.84rem;
		border-radius: 10px;
		border: 1px solid #0f172a;
		background: #0f172a;
		color: #fff;
	}

	.notice {
		padding: 0.65rem 0.75rem;
		border-radius: 10px;
		font-size: 0.86rem;
		font-weight: 600;
		background: #fff1f2;
		border: 1px solid #fda4af;
		color: #9f1239;
	}
</style>
