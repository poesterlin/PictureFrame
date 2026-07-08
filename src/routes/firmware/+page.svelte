<script lang="ts">
	import { onMount } from 'svelte';

	let serialSupported = $state(true);

	onMount(() => {
		serialSupported = 'serial' in navigator;
	});
</script>

<svelte:head>
	<title>Firmware Update - PictureFrame</title>
	<script
		type="module"
		src="https://unpkg.com/esp-web-tools@10/dist/web/install-button.js"
	></script>
</svelte:head>

<section class="firmware">
	<div class="card">
		<h1>Firmware Update</h1>

		{#if !serialSupported}
			<div class="warning">
				<h2>Browser nicht unterstützt</h2>
				<p>
					Dein Browser unterstützt kein Web Serial. Bitte verwende einen Chromium-basierten Browser
					(Chrome, Edge, Opera, Brave) auf einem Desktop-Computer.
				</p>
			</div>
		{:else}
			<div class="steps">
				<div class="step">
					<div class="step-num">1</div>
					<div class="step-body">
						<h3>ESP32-C6 per USB verbinden</h3>
						<p>Schließe den Frame mit einem USB-C Kabel an deinen Computer an.</p>
					</div>
				</div>
				<div class="step">
					<div class="step-num">2</div>
					<div class="step-body">
						<h3>Firmware installieren</h3>
						<p>
							Wichtig: Halte die BOOT-Taste gedrückt und drücke kurz RST, dann lasse BOOT los, um
							den Bootloader zu aktivieren.
						</p>
						<div class="install-wrapper">
							<esp-web-install-button manifest="/firmware/manifest.json">
								<button class="install-btn" slot="activate"> Firmware installieren </button>
								<span slot="unsupported">Browser nicht unterstützt.</span>
								<span slot="not-allowed">Keine serielle Verbindung erlaubt.</span>
							</esp-web-install-button>
						</div>
						<p class="note">Nach erfolgreichem Flash startet der Frame automatisch neu.</p>
					</div>
				</div>
				<div class="step">
					<div class="step-num">3</div>
					<div class="step-body">
						<h3>WLAN einrichten</h3>
						<p>Nach dem Flashen muss der Frame neu mit deinem WLAN verbunden werden.</p>
						<a class="button" href="/connect">Zum WLAN Setup</a>
					</div>
				</div>
			</div>

			<details class="info">
				<summary>Firmware-Datei bereitstellen (Admin)</summary>
				<p>
					Platziere die gemerged Firmware als <code>static/firmware/merged.bin</code> und passe die
					Version in <code>static/firmware/manifest.json</code> an.
					<br />
					Merge-Befehl mit esptool:
				</p>
				<pre><code
						>esptool.py --chip esp32c6 merge_bin \
  -o static/firmware/merged.bin \
  --flash_mode dio --flash_size 4MB --flash_freq 80m \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0xf000 build/ota_data_initial.bin \
  0x20000 build/pictureframe_esp32s3.bin</code
					></pre>
			</details>
		{/if}
	</div>
</section>

<style>
	.firmware {
		min-height: 100vh;
		padding: clamp(1rem, 3vw, 2.5rem);
		background:
			radial-gradient(circle at 10% 10%, rgba(250, 117, 117, 0.26), transparent 35%),
			radial-gradient(circle at 90% 0%, rgba(24, 52, 94, 0.24), transparent 40%),
			linear-gradient(170deg, #edf7fb 0%, #dbeaf0 60%, #d2e6ef 100%);
	}

	.card {
		max-width: 720px;
		margin: 0 auto;
		padding: clamp(1rem, 3vw, 2rem);
		border-radius: 20px;
		background: rgba(255, 255, 255, 0.75);
		border: 1px solid rgba(20, 40, 60, 0.12);
		box-shadow: 0 30px 65px -45px rgba(14, 28, 40, 0.7);
		backdrop-filter: blur(5px);
	}

	h1 {
		margin: 0 0 1rem;
		font-size: clamp(1.5rem, 3vw, 2.2rem);
		color: #0f2234;
	}

	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
		color: #8b2c2c;
	}

	h3 {
		margin: 0;
		font-size: 1rem;
		color: #10263a;
	}

	.warning {
		padding: 0.95rem;
		border-radius: 12px;
		background: #fff0f0;
		border: 1px solid #e88;
	}

	.warning p {
		margin: 0.4rem 0 0;
		font-size: 0.88rem;
		color: #604040;
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.step {
		display: flex;
		gap: 0.8rem;
		padding: 0.95rem;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.7);
		border: 1px solid rgba(15, 34, 52, 0.08);
	}

	.step-num {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: #0f2234;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.82rem;
		font-weight: 700;
		margin-top: 1px;
	}

	.step-body {
		flex: 1;
	}

	.step-body p {
		margin: 0.3rem 0 0;
		font-size: 0.85rem;
		color: #40566a;
	}

	.install-wrapper {
		margin-top: 0.7rem;
	}

	.install-btn {
		font-family: inherit;
		font-size: 0.92rem;
		font-weight: 700;
		padding: 0.7rem 1.5rem;
		border-radius: 10px;
		border: none;
		background: #0f2234;
		color: #fff;
		cursor: pointer;
		transition: background 120ms ease;
	}

	.install-btn:hover {
		background: #1a3a54;
	}

	.note {
		font-size: 0.8rem !important;
		color: #708090 !important;
	}

	.button {
		display: inline-flex;
		align-items: center;
		margin-top: 0.6rem;
		font-family: inherit;
		text-decoration: none;
		border-radius: 10px;
		padding: 0.58rem 0.95rem;
		font-size: 0.88rem;
		font-weight: 700;
		background: rgba(255, 255, 255, 0.8);
		border: 1px solid rgba(15, 34, 52, 0.2);
		color: #0f2234;
		transition:
			transform 120ms ease,
			box-shadow 120ms ease;
	}

	.button:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 14px -10px rgba(0, 0, 0, 0.4);
	}

	.info {
		margin-top: 1.5rem;
		padding: 0.85rem;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.5);
		border: 1px solid rgba(15, 34, 52, 0.08);
		font-size: 0.84rem;
	}

	.info summary {
		cursor: pointer;
		font-weight: 600;
		color: #40566a;
	}

	.info p {
		margin: 0.5rem 0 0;
		color: #40566a;
	}

	.info code {
		background: rgba(15, 34, 52, 0.07);
		padding: 0.15rem 0.35rem;
		border-radius: 5px;
		font-size: 0.82rem;
	}

	.info pre {
		margin: 0.5rem 0 0;
		padding: 0.75rem;
		border-radius: 8px;
		background: #0f2234;
		color: #c8d8e8;
		font-size: 0.78rem;
		overflow-x: auto;
	}
</style>
