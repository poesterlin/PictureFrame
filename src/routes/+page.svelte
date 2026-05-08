<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<section class="home">
	{#if data.user}
		<div class="hero owner">
			<h1>Willkommen, {data.user.username}</h1>

			<div class="grid owner-grid">
				{#if data.isAdmin}
					<a class="card" href="/admin">
						<h2>Admin</h2>
						<p>Geschenk-Frames vorbereiten und später per Claim-Code übergeben.</p>
					</a>
					<a class="card" href="/preview">
						<h2>Bilder</h2>
						<p>Bilder manuell anzeigen und verwalten.</p>
					</a>
				{:else}
					<a class="card" href="/preview">
						<h2>Bilder</h2>
						<p>Bilder manuell anzeigen und verwalten.</p>
					</a>
					<a class="card" href="/settings">
						<h2>Frame steuern</h2>
						<p>Intervall, Upload-Links und Wartungsaktionen verwalten.</p>
					</a>
				{/if}
				<a class="card" href="/connect">
					<h2>WLAN verbinden</h2>
					<p>WLAN Setup für den Frame starten.</p>
				</a>
			</div>
			<div class="auth-row">
				{#if !data.isAdmin}
					<a class="button primary" href="/upload">Zum Upload</a>
				{/if}
				<a class="button subtle" href="/profile">Profil</a>
			</div>
		</div>
	{:else}
		<div class="hero party">
			<h1>Dein Frame</h1>
			<p class="lead">
				Um deinen Frame einzurichten, benötigst du einen Invite-Code. Mit deinem Frame hast du einen Code erhalten der dich zur Registrierung berechtigt.
			</p>
			<div class="auth-row">
				<a class="button subtle" href="/login?redirect=%2F">Login</a>
			</div>
		</div>
	{/if}
</section>

<style>
	.home {
		min-height: 100vh;
		padding: clamp(1rem, 3vw, 2.5rem);
		background:
			radial-gradient(circle at 10% 10%, rgba(250, 117, 117, 0.26), transparent 35%),
			radial-gradient(circle at 90% 0%, rgba(24, 52, 94, 0.24), transparent 40%),
			linear-gradient(170deg, #edf7fb 0%, #dbeaf0 60%, #d2e6ef 100%);
	}

	.hero {
		max-width: 900px;
		margin: 0 auto;
		padding: clamp(1rem, 3vw, 2rem);
		border-radius: 20px;
		background: rgba(255, 255, 255, 0.75);
		border: 1px solid rgba(20, 40, 60, 0.12);
		box-shadow: 0 30px 65px -45px rgba(14, 28, 40, 0.7);
		backdrop-filter: blur(5px);
	}

	.hero.party {
		max-width: 720px;
	}

	.hero.owner {
		max-width: 980px;
	}

	h1 {
		margin: 0.45rem 0 0;
		font-size: clamp(1.7rem, 4vw, 3rem);
		line-height: 1.1;
		color: #0f2234;
	}

	.lead {
		margin: 0.9rem 0 0;
		max-width: 70ch;
		font-size: clamp(0.95rem, 1.3vw, 1.1rem);
		color: #344b60;
	}

	.auth-row {
		margin-top: 1.25rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}

	.button {
		font-family: inherit;
		text-decoration: none;
		border-radius: 10px;
		padding: 0.58rem 0.95rem;
		font-size: 0.88rem;
		font-weight: 700;
		line-height: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		appearance: none;
		cursor: pointer;
	}

	.button.primary {
		background: #0f2234;
		color: #fff;
	}

	.button.subtle {
		background: rgba(255, 255, 255, 0.8);
		border-color: rgba(15, 34, 52, 0.2);
		color: #0f2234;
	}

	.grid {
		margin: 1.1rem auto 0;
		max-width: 980px;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 0.75rem;
	}

	.owner-grid {
		margin-top: 1rem;
	}

	.card {
		display: grid;
		gap: 0.55rem;
		text-decoration: none;
		padding: 0.95rem;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.84);
		border: 1px solid rgba(15, 34, 52, 0.12);
		color: inherit;
		transition:
			transform 120ms ease,
			box-shadow 120ms ease,
			border-color 120ms ease;
	}

	.card:hover {
		transform: translateY(-2px);
		border-color: rgba(15, 34, 52, 0.28);
		box-shadow: 0 12px 24px -16px rgba(0, 0, 0, 0.45);
	}

	h2 {
		margin: 0;
		font-size: 1.03rem;
		color: #10263a;
	}

	.card p {
		margin: 0;
		font-size: 0.87rem;
		color: #40566a;
	}
</style>
