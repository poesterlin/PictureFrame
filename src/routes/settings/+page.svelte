<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';

	export let data: {
		frame: { id: number; frameName: string; refreshEverySeconds: number } | null;
		links: Array<{
			id: number;
			frameId: number;
			uploadCount: number;
			disabled: boolean;
			frameName: string;
		}>;
	};
	export let form:
		| {
				success?: boolean;
				settingsSaved?: boolean;
				uploadUrl?: string;
				message?: string;
		  }
		| undefined;

	const REFRESH_MIN = 30;
	const REFRESH_MAX = 6 * 60 * 60;

	let settings = {
		refreshEvery: data.frame?.refreshEverySeconds ?? 10 * 60
	};

	let notice = '';
	let noticeType: 'success' | 'error' = 'success';
	let linkNotice = '';
	let linkNoticeType: 'success' | 'error' = 'success';
	let newUploadUrl = '';

	$: if (form?.uploadUrl) {
		newUploadUrl = new URL(form.uploadUrl, $page.url.origin).toString();
		linkNotice = 'Upload-Link erstellt.';
		linkNoticeType = 'success';
	}

	$: if (form?.message) {
		linkNotice = form.message;
		linkNoticeType = 'error';
		notice = form.message;
		noticeType = 'error';
	}

	$: if (form?.settingsSaved) {
		notice = 'Einstellungen erfolgreich gespeichert.';
		noticeType = 'success';
	}

	function formatInterval(seconds: number) {
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
		if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
		return `${Math.round(seconds / 86400)} d`;
	}

	async function copyUploadUrl() {
		if (!newUploadUrl) return;
		await navigator.clipboard.writeText(newUploadUrl);
		linkNotice = 'Link in die Zwischenablage kopiert.';
		linkNoticeType = 'success';
	}

	const presets = [
		{ label: '10 min', value: 600 },
		{ label: '30 min', value: 1800 },
		{ label: '1 h', value: 3600 },
		{ label: '3 h', value: 10800 }
	];

</script>

<section class="settings-wrap">
	<div class="settings-card">
		<form method="POST" action="?/saveSettings" use:enhance>
			<header>
				<h1>Anzeigeeinstellungen</h1>
			</header>

			<div class="group">
				<div class="refresh-row">
					<label for="refresh">Aktualisierungsintervall</label>
					<strong>{formatInterval(settings.refreshEvery)}</strong>
				</div>
				<input
					type="range"
					id="refresh"
					name="refreshEvery"
					min={REFRESH_MIN}
					max={REFRESH_MAX}
					step="30"
					bind:value={settings.refreshEvery}
				/>
				<div class="preset-row">
					{#each presets as preset}
						<button
							type="button"
							class="preset"
							on:click={() => (settings.refreshEvery = preset.value)}
						>{preset.label}</button
						>
					{/each}
				</div>
				<button class="primary" type="submit">
					Einstellungen speichern
				</button>
			</div>

			{#if notice}
				<p class="notice" data-type={noticeType}>{notice}</p>
			{/if}
		</form>

		<div class="group">
			<h2>Upload-Link</h2>
			{#if data.frame}
				<p class="subtitle">
					Sende diesen Link an Freunde und Familie, damit sie Fotos direkt auf deinen Rahmen hochladen können.
				</p>
				<form method="POST" action="?/createUploadLink" class="link-form" use:enhance>
					<input type="hidden" name="frameId" value={data.frame.id} />
					<button class="primary" type="submit">Upload-Link erstellen</button>
				</form>

				{#if newUploadUrl}
					<div class="created-link">
						<code>{newUploadUrl}</code>
						<button type="button" on:click={copyUploadUrl}>Link kopieren</button>
					</div>
				{/if}

				{#if data.links.length > 0}
					<div class="links-list">
						{#each data.links as link}
							<div class="link-row">
								<div>
									<p>{link.uploadCount} Hochladungen {#if link.disabled}| deaktiviert{/if}</p>
								</div>
								{#if !link.disabled}
									<form method="POST" action="?/disableUploadLink">
										<input type="hidden" name="linkId" value={link.id} />
										<button type="submit" class="danger">Link deaktivieren</button>
									</form>
								{:else}
									<form method="POST" action="?/deleteUploadLink">
										<input type="hidden" name="linkId" value={link.id} />
										<button type="submit">Link löschen</button>
									</form>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{:else}
				<p class="subtitle">Kein Rahmen mit deinem Account verknüpft.</p>
			{/if}

			{#if linkNotice}
				<p class="notice" data-type={linkNoticeType}>{linkNotice}</p>
			{/if}
		</div>
	</div>
</section>

<style>
	:global(body) {
		background:
			radial-gradient(circle at 0% 0%, rgba(255, 76, 76, 0.15), transparent 42%),
			radial-gradient(circle at 100% 0%, rgba(15, 15, 15, 0.12), transparent 36%),
			#e6ecef;
	}

	.settings-wrap {
		display: grid;
		place-items: center;
		padding: clamp(1rem, 4vw, 2.4rem);
	}

	.settings-card {
		width: min(780px, 100%);
		display: grid;
		gap: 1rem;
		padding: clamp(1.2rem, 3vw, 2rem);
		border-radius: 20px;
		background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(245, 248, 249, 0.88));
		border: 1px solid rgba(17, 24, 39, 0.1);
		box-shadow:
			0 30px 70px -45px rgba(0, 0, 0, 0.6),
			0 10px 22px -16px rgba(0, 0, 0, 0.4);
	}

	header {
		display: grid;
		gap: 0.25rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.4rem, 4vw, 2.1rem);
		color: #111827;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
	}

	.subtitle {
		margin: 0;
		font-size: 0.94rem;
		color: #56606f;
	}

	.group {
		display: grid;
		gap: 0.7rem;
		padding: 1rem;
		border-radius: 14px;
		border: 1px solid rgba(11, 18, 30, 0.12);
		background: rgba(255, 255, 255, 0.64);
	}

	label {
		font-size: 0.86rem;
		font-weight: 600;
		color: #2f3a48;
	}

	input[type='range']:focus-visible,
	button:focus-visible {
		outline: 3px solid rgba(255, 68, 68, 0.34);
		outline-offset: 2px;
	}

	.refresh-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.refresh-row strong {
		font-size: 0.95rem;
		padding: 0.22rem 0.5rem;
		border-radius: 999px;
		background: #111827;
		color: #fff;
	}

	input[type='range'] {
		width: 100%;
		accent-color: #e11d48;
	}

	.link-form {
		display: grid;
		gap: 0.55rem;
	}

	.created-link {
		display: grid;
		gap: 0.45rem;
		margin-top: 0.35rem;
	}

	.created-link code {
		display: block;
		padding: 0.5rem 0.65rem;
		border-radius: 8px;
		background: #eef2ff;
		font-size: 0.8rem;
	}

	.links-list {
		display: grid;
		gap: 0.55rem;
	}

	.link-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem;
		border: 1px solid rgba(17, 24, 39, 0.12);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.75);
	}

	.link-row p {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: #4b5563;
	}

	.preset-row {
		display: grid;
		gap: 0.55rem;
		grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
	}

	button{
		font: inherit;
		font-size: 0.9rem;
		padding: 0.72rem 0.8rem;
		border-radius: 10px;
		border: 1px solid rgba(17, 24, 39, 0.2);
		background: #f8fafc;
		color: #111827;
		text-decoration: none;
		text-align: center;
		transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
	}

	button:hover{
		transform: translateY(-1px);
		border-color: rgba(17, 24, 39, 0.38);
		box-shadow: 0 8px 20px -16px rgba(0, 0, 0, 0.65);
	}

	button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
		transform: none;
	}

	.primary {
		background: #111827;
		color: #f8fafc;
		border-color: #111827;
	}

	.preset {
		font-size: 0.82rem;
		padding: 0.48rem 0.58rem;
	}

	.danger {
		background: #fff1f2;
		border-color: #fb7185;
		color: #9f1239;
	}

	.notice {
		margin: 0;
		padding: 0.74rem 0.8rem;
		border-radius: 10px;
		font-size: 0.86rem;
		font-weight: 600;
	}

	.notice[data-type='success'] {
		background: #ecfdf3;
		color: #166534;
		border: 1px solid #86efac;
	}

	.notice[data-type='error'] {
		background: #fff1f2;
		color: #9f1239;
		border: 1px solid #fda4af;
	}

	@media (max-width: 520px) {
		.preset-row {
			grid-template-columns: 1fr;
		}

		.settings-card {
			padding: 1rem;
		}

		.link-row {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
