<script lang="ts">
	const REFRESH_MIN = 30;
	const REFRESH_MAX = 6 * 60 * 60;

	let settings = {
		deleteCurrent: false,
		reboot: false,
		refreshNow: false,
		refreshEvery: 10 * 60,
		clearLog: false,
		syncNow: false,
		deviceId: 'default'
	};

	let isSaving = false;
	let notice = '';
	let noticeType: 'success' | 'error' = 'success';

	function formatInterval(seconds: number) {
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
		if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
		return `${Math.round(seconds / 86400)} d`;
	}

	function setNotice(message: string, type: 'success' | 'error' = 'success') {
		notice = message;
		noticeType = type;
	}

	function resetOneTimeFlags() {
		settings.deleteCurrent = false;
		settings.reboot = false;
		settings.refreshNow = false;
		settings.syncNow = false;
		settings.clearLog = false;
	}

	async function sendSettings() {
		if (isSaving) return;
		isSaving = true;
		setNotice('');

		try {
			const form = new FormData();
			form.append('json', JSON.stringify(settings));

			const response = await fetch('/settings', { method: 'POST', body: form });
			if (!response.ok) {
				throw new Error(`Request failed (${response.status})`);
			}

			setNotice('Einstellungen erfolgreich gespeichert.');
		} catch (error) {
			console.error(error);
			setNotice('Speichern fehlgeschlagen. Bitte erneut versuchen.', 'error');
		} finally {
			resetOneTimeFlags();
			isSaving = false;
		}
	}

	async function saveAll(event: SubmitEvent) {
		event.preventDefault();
		await sendSettings();
	}

	async function runAction(
		changes: Partial<typeof settings>,
		confirmMessage?: string,
		successMessage?: string
	) {
		if (confirmMessage && !confirm(confirmMessage)) return;

		Object.assign(settings, changes);
		await sendSettings();

		if (successMessage && noticeType === 'success') {
			setNotice(successMessage, 'success');
		}
	}

	const presets = [
		{ label: '1 min', value: 60 },
		{ label: '10 min', value: 600 },
		{ label: '30 min', value: 1800 },
		{ label: '1 h', value: 3600 },
		{ label: '3 h', value: 10800 }
	];
</script>

<section class="settings-wrap">
	<form class="settings-card" on:submit={saveAll}>
		<header>
			<p class="kicker">Picture Frame</p>
			<h1>Display Settings</h1>
			<p class="subtitle">Steuere Update-Intervall, Sync und Wartung in einer Ansicht.</p>
		</header>

		<div class="group">
			<a class="link-tile" href="/connect">WLAN verbinden</a>
			<label for="deviceId">Device ID</label>
			<input
				type="text"
				id="deviceId"
				bind:value={settings.deviceId}
				placeholder="default"
				autocomplete="off"
			/>
		</div>

		<div class="group">
			<div class="refresh-row">
				<label for="refresh">Refresh Intervall</label>
				<strong>{formatInterval(settings.refreshEvery)}</strong>
			</div>
			<input
				type="range"
				id="refresh"
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
			<button class="primary" type="submit" disabled={isSaving}>
				{isSaving ? 'Speichert...' : 'Einstellungen speichern'}
			</button>
		</div>

		<div class="actions">
			<button
				type="button"
				on:click={() => runAction({ refreshNow: true }, undefined, 'Naechstes Bild angefordert.')}
				disabled={isSaving}
			>
				Naechstes Bild
			</button>
			<button
				type="button"
				on:click={() => runAction({ syncNow: true }, undefined, 'Sofort-Sync gestartet.')}
				disabled={isSaving}
			>
				Jetzt synchronisieren
			</button>
			<button
				type="button"
				on:click={() => runAction({ clearLog: true }, 'Logs wirklich loeschen?', 'Logs geloescht.')}
				disabled={isSaving}
			>
				Logs loeschen
			</button>
			<button
				type="button"
				on:click={() =>
					runAction(
						{ deleteCurrent: true },
						'Aktuelles Bild unwiderruflich loeschen?',
						'Aktuelles Bild geloescht.'
					)
				}
				disabled={isSaving}
			>
				Aktuelles Bild loeschen
			</button>
			<button
				type="button"
				class="danger"
				on:click={() => runAction({ reboot: true }, 'Rahmen jetzt neu starten?', 'Neustart ausgelost.')}
				disabled={isSaving}
			>
				Rahmen neu starten
			</button>
		</div>

		{#if notice}
			<p class="notice" data-type={noticeType}>{notice}</p>
		{/if}
	</form>
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

	.kicker {
		margin: 0;
		font-size: 0.73rem;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: #657280;
		font-weight: 700;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.4rem, 4vw, 2.1rem);
		color: #111827;
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

	input[type='text'] {
		padding: 0.7rem 0.8rem;
		font: inherit;
		border-radius: 10px;
		border: 1px solid rgba(17, 24, 39, 0.24);
		background: #fff;
	}

	input[type='text']:focus-visible,
	button:focus-visible,
	a:focus-visible {
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

	.preset-row,
	.actions {
		display: grid;
		gap: 0.55rem;
		grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
	}

	button,
	.link-tile {
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

	button:hover,
	.link-tile:hover {
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
		.actions,
		.preset-row {
			grid-template-columns: 1fr;
		}

		.settings-card {
			padding: 1rem;
		}
	}
</style>
