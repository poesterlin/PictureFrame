<script lang="ts">
	import { bleProfile } from '$lib/device-contract';

	let ssid = '';
	let password = '';
	let deviceId = 'default';
	let logs: string[] = [];
	let status = 'Bereit';
	let isProvisioning = false;
	let isLoadingLogs = false;
	let connectedDeviceName = '';

	type BleContext = {
		device: BluetoothDevice;
		server: BluetoothRemoteGATTServer;
		service: BluetoothRemoteGATTService;
	};

	async function withBleContext() {
		if (!navigator.bluetooth) {
			throw new Error('Web Bluetooth wird von diesem Browser nicht unterstuetzt.');
		}

		status = 'Suche nach Geraet...';
		const device = await navigator.bluetooth.requestDevice({
			filters: [{ services: [bleProfile.serviceUuid] }]
		});

		if (!device.gatt?.connect) {
			throw new Error('GATT Verbindung ist nicht verfuegbar.');
		}

		status = 'Verbinde...';
		const server = await device.gatt.connect();
		if (!server.connected) {
			throw new Error('Bluetooth-Verbindung fehlgeschlagen.');
		}

		const service = await server.getPrimaryService(bleProfile.serviceUuid);
		connectedDeviceName = device.name || 'Unbekanntes Geraet';
		return { device, server, service } as BleContext;
	}

	function disconnect(context: BleContext | undefined) {
		if (context?.device.gatt?.connected) {
			context.device.gatt.disconnect();
		}
	}

	async function onProvision(event: SubmitEvent) {
		event.preventDefault();

		if (!ssid.trim()) {
			status = 'SSID fehlt.';
			return;
		}

		isProvisioning = true;
		let context: BleContext | undefined;

		try {
			context = await withBleContext();
			status = 'Uebertrage WLAN-Daten...';

			const characteristic = await context.service.getCharacteristic(
				bleProfile.wifiWriteCharacteristicUuid
			);

			const encoder = new TextEncoder();
			const payload = {
				type: 'wifiProvision',
				ssid: ssid.trim(),
				password,
				deviceId: deviceId.trim() || 'default'
			};
			await characteristic.writeValue(encoder.encode(JSON.stringify(payload)));
			status = `WLAN-Provisioning gesendet an ${connectedDeviceName}.`;
		} catch (error) {
			status = error instanceof Error ? error.message : 'Provisioning fehlgeschlagen.';
		} finally {
			disconnect(context);
			isProvisioning = false;
		}
	}

	async function getLogs() {
		isLoadingLogs = true;
		let context: BleContext | undefined;

		try {
			context = await withBleContext();
			status = 'Lese Logs...';

			const characteristic = await context.service.getCharacteristic(
				bleProfile.logReadCharacteristicUuid
			);
			const logBuffer = await characteristic.readValue();
			const decoder = new TextDecoder();
			logs = decoder
				.decode(logBuffer)
				.split('\n')
				.map((entry) => entry.trim())
				.filter(Boolean);

			status = `Logs geladen von ${connectedDeviceName}.`;
		} catch (error) {
			status = error instanceof Error ? error.message : 'Logs konnten nicht geladen werden.';
		} finally {
			disconnect(context);
			isLoadingLogs = false;
		}
	}

	function parseLog(log: string) {
		const [isoDate, ...message] = log.split(' ');

		const isDateValid = !isNaN(Date.parse(isoDate));
		if (!isDateValid) {
			return { time: '', message: log };
		}

		const date = new Date(isoDate);
		return { time: date.toLocaleTimeString(), message: message.join(' ') };
	}
</script>

<section class="connect-wrap">
	<form class="connect-card" on:submit={onProvision}>
		<h1>WLAN via Bluetooth</h1>
		<p class="subtitle">SSID und Passwort direkt an deinen Frame uebertragen.</p>

		<div class="field-row">
			<label for="ssid">SSID</label>
			<input type="text" id="ssid" bind:value={ssid} autocomplete="off" required />
		</div>
		<div class="field-row">
			<label for="deviceId">Device ID</label>
			<input type="text" id="deviceId" bind:value={deviceId} autocomplete="off" />
		</div>
		<div class="field-row">
			<label for="password">Passwort</label>
			<input type="password" id="password" bind:value={password} autocomplete="current-password" />
		</div>

		<div class="actions">
			<button type="submit" disabled={isProvisioning || isLoadingLogs}>
				{isProvisioning ? 'Sende...' : 'Ueber Bluetooth uebertragen'}
			</button>
			<button type="button" class="secondary" on:click={getLogs} disabled={isLoadingLogs || isProvisioning}>
				{isLoadingLogs ? 'Lade Logs...' : 'Logs laden'}
			</button>
		</div>

		<p class="status">{status}</p>
	</form>
</section>

{#if logs.length > 0}
	<div class="logs">
		{#each logs as log}
			{@const parsed = parseLog(log)}
			<div class="log-entry">
				{#if parsed.time}<small>{parsed.time}</small>{/if}
				<span>{parsed.message}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.connect-wrap {
		display: grid;
		place-items: center;
		padding: clamp(1rem, 4vw, 2rem);
	}

	.connect-card {
		width: min(700px, 100%);
		display: grid;
		gap: 0.8rem;
		padding: clamp(1rem, 3vw, 1.7rem);
		background: rgba(255, 255, 255, 0.86);
		border: 1px solid rgba(17, 24, 39, 0.16);
		border-radius: 18px;
		box-shadow: 0 24px 55px -38px rgba(0, 0, 0, 0.6);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.35rem, 3vw, 1.9rem);
	}

	.subtitle {
		margin: 0;
		font-size: 0.95rem;
		color: #4b5563;
	}

	.field-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.45rem;
	}

	label {
		font-size: 0.88rem;
		font-weight: 600;
	}

	input {
		flex: 1 1 100%;
		padding: 0.72rem 0.8rem;
		font: inherit;
		font-size: 0.94rem;
		border-radius: 10px;
		border: 1px solid rgba(17, 24, 39, 0.24);
		background: #fff;
	}

	.actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.65rem;
		margin-top: 0.2rem;
	}

	button {
		font: inherit;
		padding: 0.75rem 0.85rem;
		border-radius: 10px;
		border: 1px solid #111827;
		background: #111827;
		color: #fff;
		cursor: pointer;
	}

	button.secondary {
		background: #f8fafc;
		color: #111827;
		border-color: rgba(17, 24, 39, 0.2);
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.logs {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0 1rem 2rem;
		width: min(900px, 100%);
		margin: 0 auto;
	}

	.log-entry {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.8rem;
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.78);
		font-size: 0.84rem;
		border: 1px solid rgba(17, 24, 39, 0.12);
	}

	small {
		color: #4b5563;
	}

	.status {
		margin: 0.2rem 0 0;
		font-size: 0.87rem;
		font-weight: 600;
		color: #374151;
	}
</style>
