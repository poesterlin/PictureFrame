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

	type ProvisionMode = 'ble' | 'serial';
	let mode: ProvisionMode = navigator.bluetooth ? 'ble' : 'serial';

	$: bleAvailable = !!navigator.bluetooth;
	$: serialAvailable = typeof navigator !== 'undefined' && 'serial' in navigator;
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

	function disconnectBle(context: BleContext | undefined) {
		if (context?.device.gatt?.connected) {
			context.device.gatt.disconnect();
		}
	}

	async function provisionBle() {
		const context = await withBleContext();
		status = 'Übertrage WLAN-Daten...';

		const characteristic = await context.service.getCharacteristic(
			bleProfile.wifiWriteCharacteristicUuid
		);

		const encoder = new TextEncoder();
		const payload = {
			type: 'wifiProvision',
			ssid: ssid.trim(),
			password,
			authKey: selectedFrame?.authKey
		};
		await characteristic.writeValue(encoder.encode(JSON.stringify(payload)));
		status = `Konfiguration gesendet an ${connectedDeviceName}.`;
		disconnectBle(context);
	}

	async function provisionSerial() {
		if (!('serial' in navigator)) {
			throw new Error('Web Serial wird von diesem Browser nicht unterstützt.');
		}

		status = 'Wähle den USB-Port des ESP32...';
		const port = await (navigator as any).serial.requestPort();
		connectedDeviceName = 'USB-Serial';

		status = 'Öffne serielle Verbindung...';
		await port.open({ baudRate: 115200 });

		try {
			const textEncoder = new TextEncoder();
			const textDecoder = new TextDecoder();
			const writer = port.writable.getWriter();
			const reader = port.readable.getReader();

			const payload = {
				type: 'wifiProvision',
				ssid: ssid.trim(),
				password,
				authKey: selectedFrame?.authKey
			};
			const json = JSON.stringify(payload) + '\n';

			status = 'Übertrage WLAN-Daten...';
			await writer.write(textEncoder.encode(json));

			const timeout = 10000;
			const start = Date.now();
			let ackReceived = false;
			let buffer = '';

			status = 'Warte auf Bestätigung...';

			while (Date.now() - start < timeout) {
				const { value, done } = await reader.read();
				if (done) break;
				if (value) {
					buffer += textDecoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						try {
							const msg = JSON.parse(line);
							if (msg.type === 'wifiProvision' && msg.status === 'ok') {
								ackReceived = true;
								break;
							}
						} catch (_) {
							/* log lines and other non-JSON output */
						}
					}
					if (ackReceived) break;
				}
			}

			reader.releaseLock();
			writer.releaseLock();

			if (ackReceived) {
				status = 'Konfiguration gesendet und bestätigt. ESP32 startet neu.';
			} else {
				status = 'Keine Bestätigung empfangen, aber Daten wurden gesendet.';
			}
		} finally {
			await port.close();
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
		try {
			if (mode === 'ble') {
				await provisionBle();
			} else {
				await provisionSerial();
			}
		} catch (error) {
			console.error('Provisioning-Fehler:', error);
			status = `Konfiguration fehlgeschlagen: ${(error as Error).message || 'Unbekannter Fehler'}`;
		} finally {
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

			<div class="mode-tabs">
				<button
					type="button"
					class="mode-tab"
					class:active={mode === 'ble'}
					disabled={!bleAvailable}
					on:click={() => (mode = 'ble')}
					title={bleAvailable ? 'Bluetooth' : 'Nicht verfügbar'}
				>
					Bluetooth
				</button>
				<button
					type="button"
					class="mode-tab"
					class:active={mode === 'serial'}
					disabled={!serialAvailable}
					on:click={() => (mode = 'serial')}
					title={serialAvailable ? 'USB (Web Serial)' : 'Nicht verfügbar'}
				>
					USB
				</button>
			</div>

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
					{isProvisioning
						? 'Sende...'
						: mode === 'ble'
							? 'Über Bluetooth übertragen'
							: 'Über USB übertragen'}
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

	.mode-tabs {
		display: flex;
		gap: 0.25rem;
		border-radius: 8px;
		background: rgba(17, 24, 39, 0.06);
		padding: 0.25rem;
	}

	.mode-tab {
		flex: 1;
		padding: 0.4rem 0.6rem;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.mode-tab.active {
		background: #fff;
		color: #111827;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.mode-tab:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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
