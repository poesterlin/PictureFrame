<script lang="ts">
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import Carousel from 'svelte-carousel';

	export let data: PageData;
	let deviceId = 'default';
	let busyAction = '';
	let message = '';
	let messageType: 'ok' | 'error' = 'ok';

	function setMessage(text: string, type: 'ok' | 'error' = 'ok') {
		message = text;
		messageType = type;
	}

	async function parseResponse(response: Response) {
		if (!response.ok) {
			throw new Error(`Request failed (${response.status})`);
		}
		return response.json().catch(() => ({}));
	}

	async function deleteCurrent(currentPageIndex: number) {
		if (!confirm('wirklich loeschen?')) {
			return;
		}

		busyAction = 'delete';
		try {
			const key = data.keys![currentPageIndex];
			const response = await fetch('/command', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key })
			});
			const json = await parseResponse(response);
			if (json.ok !== true) {
				throw new Error('Loeschen konnte nicht bestaetigt werden.');
			}

			data.keys!.splice(currentPageIndex, 1);
			data = data;
			setMessage('Bild geloescht.');
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'Loeschen fehlgeschlagen.', 'error');
		} finally {
			busyAction = '';
		}
	}

	async function showCurrent(currentPageIndex: number) {
		busyAction = 'show';
		try {
			const response = await fetch('/command', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key: data.keys![currentPageIndex], deviceId: deviceId.trim() || 'default' })
			});
			await parseResponse(response);
			setMessage('Bild an den Rahmen gesendet.');
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'Anzeigen fehlgeschlagen.', 'error');
		} finally {
			busyAction = '';
		}
	}

	$: images = data.keys?.map((key) => `/preview/toImg?key=${encodeURIComponent(key)}`);
</script>

{#if browser && images}
	<section class="preview-wrap">
		<Carousel
			let:currentPageIndex={index}
			let:pagesCount
			let:showPrevPage
			let:showNextPage
			duration={100}
		>
			<div slot="prev">
				<button class="nav" on:click={showPrevPage} aria-label="Vorheriges Bild"> &lt; </button>
			</div>
			<div slot="next">
				<button class="nav" on:click={showNextPage} aria-label="Naechstes Bild"> &gt; </button>
			</div>
			<div slot="dots">
				<div class="toolbar">
					<pre>{(index + 1).toString().padStart(pagesCount.toString().length, '0')}/{pagesCount}</pre>
				</div>
				<form on:submit|preventDefault={() => showCurrent(index)}>
					<label for="deviceId">Device ID</label>
					<input type="text" id="deviceId" bind:value={deviceId} />
					<button type="submit" disabled={busyAction !== ''}>
						{busyAction === 'show' ? 'Sende...' : 'Anzeigen'}
					</button>
					<button
						type="button"
						class="danger"
						on:click={() => deleteCurrent(index)}
						disabled={busyAction !== ''}
					>
						{busyAction === 'delete' ? 'Loesche...' : 'Loeschen'}
					</button>
				</form>
				{#if message}
					<p class="msg" data-type={messageType}>{message}</p>
				{/if}
			</div>
			{#each images as src (src)}
				<img loading="lazy" {src} alt="" />
			{/each}
		</Carousel>
	</section>
{/if}

<style>
	img {
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-user-drag: none;
		-moz-user-select: -moz-none;
		-ms-user-select: none;
		user-select: none;

		filter: saturate(0.62) brightness(1.04) contrast(1.02);
	}

	.preview-wrap {
		max-width: 800px;
		max-height: 560px;
		margin: auto;
		margin-top: 20px;
	}

	button.nav {
		top: calc(50% - 35px);
		position: relative;
	}

	pre {
		text-align: center;
		margin: 0;
	}

	form {
		display: flex;
		flex-wrap: wrap;
		width: 600px;
		max-width: 95vw;
		margin: 1rem auto;
		gap: 0.4rem;
	}

	form > label,
	form > input {
		flex: 1 1 100%;
		text-align: center;
	}

	form > input {
		padding: 8px;
		font: inherit;
		border-radius: 8px;
		border: 1px solid rgba(17, 24, 39, 0.3);
	}

	form > button {
		flex: 1 1 33%;
	}

	button {
		margin: 10px;
		font-size: 0.95rem;
		letter-spacing: 0.3px;
		padding: 10px;
		border-radius: 9px;
		border: 1px solid rgba(17, 24, 39, 0.2);
		background: #f8fafc;
	}

	button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.danger {
		background: #fff1f2;
		color: #9f1239;
		border-color: #fb7185;
	}

	.toolbar {
		display: flex;
		justify-content: center;
	}

	.msg {
		text-align: center;
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.msg[data-type='ok'] {
		color: #166534;
	}

	.msg[data-type='error'] {
		color: #9f1239;
	}
</style>
