<script lang="ts">
	import { bleProfile } from '$lib/device-contract';

	let ssid = '';
	let password = '';
	let deviceId = 'default';

	let logs: string[] = [];

	async function onButtonClick() {
		const device = await navigator.bluetooth.requestDevice({
			filters: [{ services: [bleProfile.serviceUuid] }]
		});
		console.log(device);

		if (!device?.gatt?.connect) {
			console.log('no gatt connect');
			return;
		}

		const server = await device.gatt.connect();
		if (!server.connected) {
			console.log('not connected', server);
			return;
		}
		console.log('connected', server);

		const service = await server.getPrimaryService(bleProfile.serviceUuid);
		console.log('service', service);

		const characteristics = await service.getCharacteristics();
		console.log('characteristics', characteristics);

		const characteristic = await service.getCharacteristic(bleProfile.wifiWriteCharacteristicUuid);
		console.log('characteristic', characteristic);

		// subscribe to characteristic
		characteristic.addEventListener('characteristicvaluechanged', (event) => {
			console.log('value', event);
		});

		// write to characteristic
		const encoder = new TextEncoder();
		const data = { type: 'wifiProvision', ssid, password, deviceId };
		const value = encoder.encode(JSON.stringify(data));
		await characteristic.writeValue(value);
	}

	async function getLogs() {
		const device = await navigator.bluetooth.requestDevice({
			filters: [{ services: [bleProfile.serviceUuid] }]
		});
		console.log(device);

		if (!device?.gatt?.connect) {
			console.log('no gatt connect');
			return;
		}

		const server = await device.gatt.connect();
		if (!server.connected) {
			console.log('not connected', server);
			return;
		}
		console.log('connected', server);

		const service = await server.getPrimaryService(bleProfile.serviceUuid);
		console.log('service', service);

		const characteristics = await service.getCharacteristics();
		console.log('characteristics', characteristics);

		const characteristic = await service.getCharacteristic(bleProfile.logReadCharacteristicUuid);

		// subscribe to characteristic
		characteristic.addEventListener('characteristicvaluechanged', (event) => {
			console.log('value', event);
		});

		const logBuffer = await characteristic.readValue();
		const decoder = new TextDecoder();
		const logString = decoder.decode(logBuffer);
		logs = logString.split('\n');
	}

	function formatLog(log: string) {
		const [isoDate, ...message] = log.split(' ');
		
		const isDateValid = !isNaN(Date.parse(isoDate));
		if (!isDateValid) {
			return log;
		}

		const date = new Date(isoDate);
		const time = date.toLocaleTimeString();
		return `<small>${time}</small> ${message.join(' ')}`;
	}
</script>

<section>
	<h1>WLAN</h1>
	<form>
		<div>
			<label for="ssid">SSID</label>
			<input type="text" id="ssid" bind:value={ssid} />
		</div>
		<div>
			<label for="deviceId">Device ID</label>
			<input type="text" id="deviceId" bind:value={deviceId} />
		</div>
		<div>
			<label for="password">Passwort</label>
			<input type="text" id="password" bind:value={password} />
		</div>
		<button on:click={onButtonClick}> Über Bluetooth übertragen </button>
	</form>

	<button on:click={getLogs}>Get Logs</button>
</section>
<div class="logs">
	{#each logs as log}
		<span>
			{@html formatLog(log)}
		</span>
	{/each}
</div>

<style>
	section {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	form {
		display: flex;
		flex-direction: column;
	}

	div {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		gap: 20px;
	}

	label {
		margin-top: 1rem;
	}

	div:focus-within > label {
		font-weight: bold;
	}

	input {
		margin-top: 0.5rem;
		color: rgb(0, 0, 0);
		padding: 1rem;
		letter-spacing: 0.1px;
		font-size: large;
		width: 20ch;
	}

	button {
		margin-top: 1rem;
		/* modern button */
		background-color: #4caf50;
		color: white;
		padding: 15px 32px;
		text-align: center;
		text-decoration: none;
		display: inline-block;
		font-weight: bold;
		border: 1px solid gray;
		box-shadow: 0 4px 8px 0 rgba(0, 0, 0, 0.075);
		letter-spacing: 0.2px;
	}

	.logs {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 2rem 20%;
	}
</style>
