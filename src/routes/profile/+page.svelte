<script lang="ts">
	import type { ActionData, PageData } from './$types';

	export let data: PageData;
	export let form: ActionData | undefined;
</script>

<section class="profile-wrap">
	<div class="profile-card">
		<header>
			<h1>Profil</h1>
			<p>Angemeldet als <strong>{data.user.username}</strong>.</p>
		</header>

		<div class="actions">
			<form method="POST" action="?/logout">
				<button type="submit">Logout</button>
			</form>

			<form method="POST" action="?/deleteAccount">
				<button type="submit" class="danger">Account löschen</button>
			</form>
		</div>

		{#if form?.message}
			<p class="message">{form.message}</p>
		{/if}

		<a class="back" href="/">Zurück zur Startseite</a>
	</div>
</section>

<style>
	.profile-wrap {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 1rem;
		background:
			radial-gradient(circle at 10% 5%, rgba(250, 117, 117, 0.2), transparent 35%),
			radial-gradient(circle at 90% 0%, rgba(24, 52, 94, 0.2), transparent 35%),
			linear-gradient(170deg, #edf7fb 0%, #dbeaf0 60%, #d2e6ef 100%);
	}

	.profile-card {
		width: min(560px, 100%);
		padding: clamp(1rem, 3vw, 1.6rem);
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.84);
		border: 1px solid rgba(20, 40, 60, 0.12);
		box-shadow: 0 30px 65px -45px rgba(14, 28, 40, 0.7);
		display: grid;
		gap: 1rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.5rem, 4vw, 2rem);
		color: #0f2234;
	}

	p {
		margin: 0.5rem 0 0;
		color: #2f4a61;
	}

	.actions {
		display: grid;
		gap: 0.7rem;
	}

	button,
	.back {
		font: inherit;
		font-weight: 700;
		font-size: 0.9rem;
		line-height: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 0.72rem 0.95rem;
		border-radius: 10px;
		border: 1px solid rgba(15, 34, 52, 0.2);
		background: #0f2234;
		color: #fff;
		text-decoration: none;
		cursor: pointer;
	}

	.danger {
		background: #fff1f2;
		color: #9f1239;
		border-color: #fb7185;
	}

	.back {
		background: rgba(255, 255, 255, 0.8);
		color: #0f2234;
	}

	.message {
		font-size: 0.9rem;
		font-weight: 600;
		color: #9f1239;
	}
</style>
