<script lang="ts">
	import throttle from 'lodash.throttle';
	import type { DrawingOptions } from '$lib/dither';
	import type { Remote } from 'comlink';
	import { onDestroy, onMount } from 'svelte';
	import { getWorkerInstance } from '$lib/util';
	import { native } from '$lib/no-worker';

	let input: HTMLInputElement;
	let img: HTMLImageElement;
	let canvas: HTMLCanvasElement;
	let workerInstance: Remote<typeof import('$lib/dithering-worker')>;
	let context: CanvasRenderingContext2D;

	onMount(() => {
		context = canvas.getContext('2d', { willReadFrequently: true })!;
		isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
		isSafari = true;

		if (!isSafari) {
			try {
				workerInstance = getWorkerInstance();
			} catch {
				// Noop
			}
		}
	});

	onDestroy(() => {
		throttledDither.cancel();
	});

	let preview = false;
	let loading = false;

	let files: File[] | null = null;
	let fileIdx = 0;
	let reqId = Math.random() * 12345;
	let dropHover = false;
	let dragDepth = 0;

	let nameOverlay = false;
	let overlayName = 'Anonym';
	let imagePan = false;
	let isSafari = false;

	let brightness = 1;
	let saturation = 1;
	let fill = false;
	let contrastMode = true;
	let processing = false;
	let diff = { x: 0, y: 0 };
	let lastPos: { x: number; y: number } | undefined = undefined;
	let quickPreview = false;
	let pendingFullPass = false;
	let adjustingControls = false;

	$: multiple = files && files.length > 1;

	async function ditherImg() {
		if (processing) {
			pendingFullPass = pendingFullPass || !quickPreview;
			return;
		}
		processing = true;

		const imgData = context.getImageData(0, 0, 800, 480);
		const options = {
			contrastMode,
			brightness,
			overlayName,
			fill,
			diff,
			saturation,
			quick: quickPreview,
			context: isSafari ? context : undefined,
			clear: true
		} as DrawingOptions;

		let canvasBlob: Uint8ClampedArray;
		if (workerInstance) {
			canvasBlob = await workerInstance.ditherImg(imgData, options);
		} else {
			canvasBlob = await native.ditherImg(img, imgData, options);
		}

		imgData.data.set(canvasBlob);
		context.putImageData(imgData, 0, 0);

		loading = false;
		processing = false;

		if (pendingFullPass && !quickPreview) {
			pendingFullPass = false;
			void ditherImg();
		}
	}

	const throttledDither = throttle(
		() => {
			void ditherImg();
		},
		120,
		{ leading: true, trailing: true }
	);

	function getImageFiles(newFiles: FileList | File[] | null) {
		if (!newFiles?.length) {
			return [];
		}

		return Array.from(newFiles).filter((file) => file.type.startsWith('image/'));
	}

	async function uploadImg(newFiles: FileList | File[] | null = null) {
		diff = { x: 0, y: 0 };
		fill = false;

		if (newFiles) {
			files = getImageFiles(newFiles);
			fileIdx = 0;
		}

		if (!files?.length) {
			return;
		}

		const file = files[fileIdx];

		let name = window.localStorage.getItem('name');
		if (!name) {
			nameOverlay = true;
			return;
		}

		preview = true;
		loading = true;
		overlayName = decodeURIComponent(name.trim());
		if (workerInstance) {
			await workerInstance.setImg(file);
			await ditherImg();
		} else {
			img.src = URL.createObjectURL(file);
		}
	}

	async function upload() {
		loading = true;
		const blob = (await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))) as Blob;

		const form = new FormData();
		form.append('image', blob);
		form.append('name', encodeURIComponent(overlayName));
		form.append('reqId', reqId.toString());

		try {
			const target = `${window.location.pathname}${window.location.search}`;
			const response = await fetch(target, { method: 'POST', body: form });
			if (!response.ok) {
				throw new Error(`Upload fehlgeschlagen (${response.status})`);
			}

			await Promise.all([
				new Promise((res) => setTimeout(res, 1500))
			]);
		} catch (error) {
			alert(error);
		}
		reqId = Math.random() * 12345;

		loading = false;
		nextImage();
	}

	function nextImage() {
		if (fileIdx + 1 < files!.length) {
			fileIdx += 1;
			uploadImg();
		} else {
			brightness = 1;
			saturation = 1;
			input.type = '';
			input.type = 'file';
			preview = false;
			fileIdx = 0;
			files = null;
			diff = { x: 0, y: 0 };
		}
	}

	function setName() {
		if (!overlayName) {
			overlayName = 'Anonym';
		}
		window.localStorage.setItem('name', encodeURIComponent(overlayName));
		nameOverlay = false;
		uploadImg();
	}

	async function dragImage(e: PointerEvent) {
		if (!fill) {
			diff = { x: 0, y: 0 };
			return;
		}

		if (!imagePan) {
			return;
		}

		let x = 0,
			y = 0;

		if (lastPos) {
			x = e.screenX - lastPos.x;
			y = e.screenY - lastPos.y;
		}

		diff.x -= x;
		diff.y -= y;
		lastPos = { x: e.screenX, y: e.screenY };

		throttledDither();
	}

	function cancelDrag() {
		const wasPanning = imagePan;
		imagePan = false;
		lastPos = undefined;

		if (wasPanning) {
			quickPreview = false;
			void ditherImg();
		}
	}

	function startControlAdjust() {
		adjustingControls = true;
		quickPreview = true;
	}

	function startImagePan() {
		imagePan = true;
		quickPreview = true;
	}

	function endControlAdjust() {
		if (!adjustingControls) {
			return;
		}

		adjustingControls = false;
		quickPreview = false;
		void ditherImg();
	}

	function onDropZoneEnter(event: DragEvent) {
		event.preventDefault();
		dragDepth += 1;
		dropHover = true;
	}

	function onDropZoneLeave(event: DragEvent) {
		event.preventDefault();
		dragDepth = Math.max(0, dragDepth - 1);
		dropHover = dragDepth > 0;
	}

	async function onDropZone(event: DragEvent) {
		event.preventDefault();
		dragDepth = 0;
		dropHover = false;
		await uploadImg(event.dataTransfer?.files ?? null);
	}
</script>

<svelte:head>
	<style>
		body {
			background: #1f2126 !important;
			color: #f8fafc;
		}
	</style>
</svelte:head>

<svelte:body
	on:pointermove={(e) => dragImage(e)}
	on:pointerup={() => {
		cancelDrag();
		endControlAdjust();
	}}
	on:dragover|preventDefault
	on:drop|preventDefault
/>

{#if !preview}
	<div
		aria-role="button"
		class="drop-zone"
		class:active={dropHover}
		on:dragenter={onDropZoneEnter}
		on:dragover|preventDefault
		on:dragleave={onDropZoneLeave}
		on:drop={onDropZone}
	>
		<div id="preview">
			<div id="frame-bottom">
				Der Bilderrahmen benutzt ein Display mit <b>nur 7 Farben</b>
				<span id="colors">
					{#each ['white', 'black', 'red', 'green', 'blue', 'orange', 'yellow'] as col}
						<span class="color" id={col} />
					{/each}
				</span>
			</div>
		</div>

		<button class="main primary" on:click={() => input.click()}>Bild laden</button>
	</div>
{/if}
<input
	type="file"
	alt="Bild hochladen"
	bind:this={input}
	on:change={() => uploadImg(input.files)}
	multiple={true}
	accept="image/jpeg, image/png, image/jpg"
/>
{#if preview}
	<header>
		<h3>Vorschau</h3>
		<button class="reset" on:click={() => (nameOverlay = true)}>Namen zurücksetzen</button>
	</header>
{/if}

<div id="loading" class:enabled={loading}>
	<div class="lds-heart"><div /></div>
</div>

<div>
	<canvas
		width="800"
		height="480"
		class:show={preview}
		bind:this={canvas}
		on:pointerdown={startImagePan}
	/>
	<img bind:this={img} alt="hidden" class="hidden" on:load={() => ditherImg()} />
</div>

{#if preview}
	<form class="controls">
		<span
			on:click|self={() => {
				contrastMode = !contrastMode;
				ditherImg();
			}}
			on:keypress
		>
			<input type="checkbox" id="alg" bind:checked={contrastMode} on:change={() => ditherImg()} />
			<label for="alg">Hoher Kontrast</label>
		</span>

		<span
			on:click|self={() => {
				fill = !fill;
				ditherImg();
			}}
			on:keypress
		>
			<input
				type="checkbox"
				id="fill"
				bind:checked={fill}
				on:change={() => {
					cancelDrag();
					diff = { x: 0, y: 0 };
					ditherImg();
				}}
			/>
			<label for="fill">Ausfüllen</label>
		</span>

		<span class="slider">
			<input
				type="range"
				id="brightness"
				min="0.3"
				max="1.7"
				step={1 / 25}
				bind:value={brightness}
				on:pointerdown={startControlAdjust}
				on:change={endControlAdjust}
				on:input={throttledDither}
			/>
			<label for="brightness">Helligkeit</label>
		</span>

		<span class="slider">
			<input
				type="range"
				id="saturation"
				min={-0.4}
				max={2.3}
				step={1 / 25}
				bind:value={saturation}
				on:pointerdown={startControlAdjust}
				on:change={endControlAdjust}
				on:input={throttledDither}
			/>
			<label for="saturation">Sättigung</label>
		</span>
	</form>

	<div id="buttons">
		<button class="second" on:click={() => input.click()}
			>{multiple ? 'Neue Bilder' : 'Neues Bild'}</button
		>
		{#if multiple}
			<button class="second small" on:click={nextImage}>&gt;</button>
		{/if}
		<button class="primary" on:click={upload}>Hochladen</button>
	</div>
{/if}

{#if nameOverlay}
	<div class="overlay" id="nameOverlay" on:click|self={() => (nameOverlay = false)} on:keypress>
		<div>
			<h5>Hochladen als:</h5>
			<input type="text" placeholder="Name" bind:value={overlayName} />
			<button class="primary" on:click={setName}>Speichern</button>
		</div>
	</div>
{/if}

<style lang="scss">
	.hidden {
		display: none;
	}

	input[type='file'] {
		display: none;
	}
	button.main {
		margin: 6vh auto 0;
	}

	.drop-zone {
		border: 2px dashed transparent;
		border-radius: 20px;
		padding: 0.7rem 0 1.1rem;
		transition: border-color 0.2s ease, background-color 0.2s ease;
		max-width: min(86vw, 560px);
		margin: 2rem auto 0;
	}

	.drop-zone.active {
		border-color: #f8a0a0;
		background: #ffffff1f;
	}

	.drop-hint {
		text-align: center;
		color: #f3d0d0;
		font-size: 0.92rem;
		margin: 0.7rem 0 0;
	}
	button.primary {
		background: #f77878;
		padding: 23px;
		color: #ffffff;
		border: 0;
		font-weight: bold;
		letter-spacing: 0.4px;
		border-radius: 30px;
		display: block;
		width: 200px;
	}

	button.second {
		font-size: 1rem;
		background: #2b3442;
		border: 1.9px solid #fca5a5;
		padding: 19px;
		border-radius: 65px;
		flex: 1 1 50%;
		color: #f8fafc;
	}

	canvas.show {
		filter: saturate(0.4) brightness(1.1) opacity(0.8) blur(0.5px) hue-rotate(11deg);
		max-width: min(1000px, 98vw);
		margin: auto;
		display: block;
		width: 100%;
		background: black;
		touch-action: none;
		aspect-ratio: 800 / 480;
	}

	canvas:not(.show) {
		display: none;
	}

	.controls {
		display: flex;
		justify-content: space-evenly;
		gap: 10px;
		flex-wrap: wrap;
		margin: 1rem auto;
		max-width: min(1000px, 85vw);
	}
	.controls span {
		background: #ffffffd4;
		padding: 9px;
		flex: 1 1 100%;
		max-width: calc(50% - 30px);
		display: flex;
		gap: 10px;
		justify-content: center;
		color: #111827;
		border: 2px dashed #fa9494;
		align-items: center;
		font-size: 0.8rem;
	}
	input[type='range'] {
		flex: 1 1 100%;
		max-width: 60%;
	}

	@media (max-width: 700px) {
		button.reset {
			margin: -10px 0 4px;
		}
		.controls span.slider {
			max-width: calc(100% - 30px);
		}
	}

	header {
		display: flex;
		flex-direction: column;
		max-width: min(1000px, 95vw);
		margin: auto;
	}

	h3 {
		text-align: center;
		color: white;
		font-weight: bold;
		font-size: 28px;
		z-index: 1;
		position: relative;
	}

	.reset {
		align-self: end;
		background: 0;
		outline: 0;
		margin: -55px 0 1rem;
		color: #ffe4e6;
		border: 0;
		text-decoration: underline;
		z-index: 1;
	}

	div#buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-evenly;
		align-items: center;
		gap: 15px;
		max-width: calc(85vw - 52px);
		margin: 3rem auto 20vh;

		& > button {
			flex: 4 1 50%;
			max-width: min(calc(100vw - 45px), 300px);
			font-size: 0.9rem;
		}
	}

	div#buttons .small {
		flex: 1 10 20%;
	}

	.overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	#nameOverlay {
		background-color: #83abb7bd;

		div {
			background: white;
			padding: 30px;
			display: flex;
			width: 296px;
			flex-direction: column;
			align-items: center;
			flex: 1 1 300px;
			max-width: 300px;
			gap: 10px;
		}

		input {
			margin: 2rem auto 4rem;
			height: 2rem;
			display: block;
		}
	}

	#loading {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #83abb7bd;
		z-index: 2;
		opacity: 0;
		transition: all 0.3s;
		pointer-events: none;
	}
	#loading.enabled {
		opacity: 1;
	}

	.lds-heart {
		display: inline-block;
		position: relative;
		width: 80px;
		height: 80px;
		transform: rotate(45deg);
		transform-origin: 40px 40px;
	}
	.lds-heart div {
		top: 32px;
		left: 32px;
		position: absolute;
		width: 32px;
		height: 32px;
		background: #fff;
		animation: lds-heart 1.2s infinite cubic-bezier(0.215, 0.61, 0.355, 1);
	}
	.lds-heart div:after,
	.lds-heart div:before {
		content: ' ';
		position: absolute;
		display: block;
		width: 32px;
		height: 32px;
		background: #fff;
	}
	.lds-heart div:before {
		left: -24px;
		border-radius: 50% 0 0 50%;
	}
	.lds-heart div:after {
		top: -24px;
		border-radius: 50% 50% 0 0;
	}
	@keyframes lds-heart {
		0% {
			transform: scale(0.95);
		}
		5% {
			transform: scale(1.1);
		}
		39% {
			transform: scale(0.85);
		}
		45% {
			transform: scale(1);
		}
		60% {
			transform: scale(0.95);
		}
		100% {
			transform: scale(0.9);
		}
	}

	#preview {
		width: 78vw;
		margin: 8vh auto 0;
		text-align: center;
		max-width: 500px;
		font-size: 18px;
		background: rgb(157 202 215 / 98%);
		padding: 20px;
		border-radius: 8px;
		border-top-left-radius: 30px;
		border-top-right-radius: 30px;
	}

	#frame-bottom {
		background-color: rgb(157 233 244);
		border-radius: 8px;
		border-top-left-radius: 3px;
		border-top-right-radius: 3px;
		margin: 7px -30px -20px;
		color: black;
		padding: 10px;
	}

	video {
		width: 100%;
		border-radius: 20px;
	}

	#colors {
		padding: 14px;
		width: calc(100% - 28px);
		display: flex;
		justify-content: space-around;
		margin: 5px;
	}

	.color {
		width: 3rem;
		display: inline-block;
		height: 1rem;
		border-radius: 15px;
	}

	#white {
		background-color: white;
	}
	#black {
		background-color: black;
	}
	#red {
		background-color: red;
	}
	#green {
		background-color: green;
	}
	#blue {
		background-color: blue;
	}
	#orange {
		background-color: orange;
	}
	#yellow {
		background-color: yellow;
	}
</style>
