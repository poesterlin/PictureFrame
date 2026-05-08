<script lang="ts">
	import { bleProfile } from '$lib/device-contract';

	let ssid = '';
	let password = '';
	let status = 'Bereit';
	let isProvisioning = false;
	let connectedDeviceName = '';

	type BleContext = {
		device: BluetoothDevice;
		server: BluetoothRemoteGATTServer;
		service: BluetoothRemoteGATTService;
	};

	async function withBleContext() {
		if (!navigator.bluetooth) {
			throw new Error('Web Bluetooth wird von diesem Browser nicht unterstützt.');
		}

		status = 'Suche nach Gerät...';
		const device = await navigator.bluetooth.requestDevice({
			filters: [{ services: [bleProfile.serviceUuid] }]
		});

		if (!device.gatt?.connect) {
			throw new Error('GATT Verbindung ist nicht verfügbar.');
		}

		status = 'Verbinde...';
		const server = await device.gatt.connect();
		if (!server.connected) {
			throw new Error('Bluetooth-Verbindung fehlgeschlagen.');
		}

		const service = await server.getPrimaryService(bleProfile.serviceUuid);
		connectedDeviceName = device.name || 'Unbekanntes Gerät';
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
			status = 'Übertrage WLAN-Daten...';

			const characteristic = await context.service.getCharacteristic(
				bleProfile.wifiWriteCharacteristicUuid
			);

			const encoder = new TextEncoder();
			const payload = {
				type: 'wifiProvision',
				ssid: ssid.trim(),
				password
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

</script>

<section class="connect-wrap">
	<form class="connect-card" on:submit={onProvision}>
		<h1>WLAN via Bluetooth</h1>
		<p class="subtitle">SSID und Passwort direkt an deinen Frame übertragen.</p>

		<div class="field-row">
			<label for="ssid">SSID</label>
			<input type="text" id="ssid" bind:value={ssid} autocomplete="off" required />
		</div>
		<div class="field-row">
			<label for="password">Passwort</label>
			<input type="password" id="password" bind:value={password} autocomplete="current-password" />
		</div>

		<div class="actions">
			<button type="submit" disabled={isProvisioning}>
				{isProvisioning ? 'Sende...' : 'Über Bluetooth übertragen'}
			</button>
		</div>

		<p class="status">{status}</p>
	</form>
</section>

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

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.status {
		margin: 0.2rem 0 0;
		font-size: 0.87rem;
		font-weight: 600;
		color: #374151;
	}
</style>
