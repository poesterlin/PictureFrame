<script lang="ts">
	import { bleProfile } from '$lib/device-contract';

	export let data: {
		isAdmin: boolean;
		frames: Array<{ id: number; frameName: string; authKey: string }>;
	};

	let ssid = '';
	let password = '';
	let selectedFrameId: number | '' = data.frames[0]?.id ?? '';
	let status = '';
	let isProvisioning = false;
	let connectedDeviceName = '';

	$: selectedFrame = data.frames.find((frame) => frame.id === selectedFrameId);

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

		if (!selectedFrame) {
			status = 'Kein Frame ausgewählt.';
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
				password,
				authKey: selectedFrame.authKey
			};
			await characteristic.writeValue(encoder.encode(JSON.stringify(payload)));
			status = `Konfiguration gesendet an ${connectedDeviceName}.`;
		} catch (error) {
			console.error('Provisioning-Fehler:', error);
			status = 'Konfiguration fehlgeschlagen.';
		} finally {
			disconnect(context);
			isProvisioning = false;
		}
	}
</script>

<section class="connect-wrap">
	{#if data.frames.length === 0}
		<div class="connect-card">
			<h1>Kein Frame</h1>
			<p class="subtitle">
				Du hast noch keinen Frame. Registriere dich mit einem Claim-Code, um einen Frame zu
				erhalten.
			</p>
		</div>
	{:else}
		<form class="connect-card" on:submit={onProvision}>
			<h1>WLAN konfigurieren</h1>
			<p class="subtitle">SSID und Passwort direkt an deinen Frame übertragen.</p>

			{#if data.isAdmin}
				<div class="field-row">
					<label for="frame">Frame</label>
					<select id="frame" bind:value={selectedFrameId}>
						{#each data.frames as frame}
							<option value={frame.id}>{frame.frameName}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="field-row">
				<label for="ssid">SSID</label>
				<input type="text" id="ssid" bind:value={ssid} autocomplete="off" required />
			</div>
			<div class="field-row">
				<label for="password">Passwort</label>
				<input
					type="password"
					id="password"
					bind:value={password}
					autocomplete="current-password"
				/>
			</div>

			<div class="actions">
				<button type="submit" disabled={isProvisioning}>
					{isProvisioning ? 'Sende...' : 'Über Bluetooth übertragen'}
				</button>
			</div>

			<p class="status">{status}</p>
		</form>
	{/if}
</section>

<style>
	.connect-wrap {
		display: grid;
		place-items: center;
		padding: clamp(1rem, 4vw, 2rem);
		font-size: 14px;
	}

	.connect-card {
		width: min(640px, 100%);
		display: grid;
		gap: 0.75rem;
		padding: clamp(1rem, 3vw, 1.5rem);
		background: rgba(255, 255, 255, 0.92);
		border: 1px solid rgba(17, 24, 39, 0.16);
		border-radius: 16px;
		box-shadow: 0 24px 55px -38px rgba(0, 0, 0, 0.6);
	}

	h1 {
		margin: 0;
		font-size: 1.4rem;
	}

	.subtitle {
		margin: 0;
		font-size: 0.9rem;
		color: #4b5563;
	}

	.field-row {
		display: grid;
		gap: 0.3rem;
	}

	label {
		font-size: 0.85rem;
		font-weight: 600;
	}

	input,
	select {
		padding: 0.5rem 0.65rem;
		font-family: inherit;
		font-size: 0.9rem;
		border-radius: 8px;
		border: 1px solid rgba(17, 24, 39, 0.24);
		background: #fff;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.2rem;
	}

	button {
		font-family: inherit;
		font-size: 0.9rem;
		padding: 0.55rem 0.9rem;
		border-radius: 8px;
		border: 1px solid #111827;
		background: #111827;
		color: #fff;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.status {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: #374151;
		min-height: 1em;
	}
</style>
