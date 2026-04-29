<script lang="ts">
	let settings = {
		deleteCurrent: false,
		reboot: false,
		refreshNow: false,
		refreshEvery: 10 * 60,
		clearLog: false,
		syncNow: false,
		deviceId: 'default'
	};

	$: {
		if (
			settings.deleteCurrent ||
			settings.reboot ||
			settings.refreshNow ||
			settings.syncNow ||
			settings.clearLog
		) {
			upload();
		}
	}

	async function upload() {
		if (settings.reboot && !confirm('Jetzt neu starten?')) {
			settings.reboot = false;
			return;
		}

		if (settings.deleteCurrent && !confirm('Aktuelles Bild unwiederuflich löschen?')) {
			settings.deleteCurrent = false;
			return;
		}

		const form = new FormData();
		form.append('json', JSON.stringify(settings));

		await fetch('/settings', { method: 'POST', body: form });
		alert('update erfolgreich');

		settings.deleteCurrent = false;
		settings.reboot = false;
		settings.refreshNow = false;
		settings.syncNow = false;
		settings.clearLog = false;
	}

	function format(interval: number) {
		const units: [string, number][] = [
			['s', 60],
			['min', 60],
			['h', 24],
			['d', Infinity]
		];

		for (const [unit, mod] of units) {
			if (interval < mod) {
				return interval.toFixed(0) + unit;
			}

			interval /= mod;
			interval = Math.ceil(interval);
		}

		return 'fehler';
	}
</script>

<form>
	<a class="fill" href="/connect">Wlan verbinden</a>
	<span>
		<label for="deviceId">Device ID</label>
		<input type="text" id="deviceId" bind:value={settings.deviceId} />
		<input
			type="range"
			id="refresh"
			min="30"
			max={6 * 60 * 60}
			bind:value={settings.refreshEvery}
		/>
		<label for="refresh">Interval: {format(settings.refreshEvery)}</label>
		<div id="buttons">
			<button class="primary" on:click={upload}>Update</button>
		</div>
	</span>

	<button class="fill" on:click={() => (settings.refreshNow = true)}>Nächstes Bild</button>
	<button class="fill" on:click={() => (settings.clearLog = true)}>Logs löschen</button>
	<button class="fill" on:click={() => (settings.syncNow = true)}>Jetzt synchronisieren</button>
	<button class="danger" on:click={() => (settings.reboot = true)}>Rahmen Neustarten</button>

</form>

<style>
	form {
		display: flex;
		flex-wrap: wrap;
		width: 600px;
		max-width: 95vw;
		margin: 10dvh auto;
	}

	span {
		flex: 1 1 100%;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		margin-bottom: 3rem;
	}

	input,
	label {
		flex: 1 1 100%;
		text-align: center;
	}

	form > button {
		flex: 1 1 33%;
	}

	button.fill {
		flex: 1 1 100%;
	}

	button, a {
		margin: 10px;
		font-size: 100%;
		letter-spacing: 0.3px;
		padding: 10px;
	}

	.danger {
		background: rgba(137, 137, 137, 0.245);
		color: white;
		border: 0;
		outline: 3px solid rgb(254, 0, 0);
	}
</style>
