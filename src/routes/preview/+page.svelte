<script lang="ts">
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import Carousel from 'svelte-carousel';

	export let data: PageData;
	type Flags = { favorite: boolean; skipped: boolean };

	let keys = [...(data.keys ?? [])];
	let flagsByKey: Record<string, Flags> = { ...(data.flagsByKey ?? {}) };
	let busyAction = '';
	let message = '';
	let messageType: 'ok' | 'error' = 'ok';
	let index = 0;

	$: images = keys.map((key) => `/preview/toImg?key=${encodeURIComponent(key)}`);
	$: pageCount = images.length;
	$: {
		if (!Number.isFinite(index)) {
			index = 0;
		}
		if (pageCount === 0) {
			index = 0;
		} else if (index < 0) {
			index = 0;
		} else if (index >= pageCount) {
			index = pageCount - 1;
		}
	}

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
		if (!confirm('wirklich löschen?')) {
			return;
		}

		busyAction = 'delete';
		try {
			const key = keys[currentPageIndex];
			if (!key) {
				throw new Error('Kein Bild ausgewählt.');
			}
			const response = await fetch('/preview/action', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key })
			});
			const json = await parseResponse(response);
			if (json.ok !== true) {
				throw new Error('Löschen konnte nicht bestätigt werden.');
			}

			keys.splice(currentPageIndex, 1);
			keys = keys;
			delete flagsByKey[key];
			flagsByKey = flagsByKey;
			setMessage('Bild gelöscht.');
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.', 'error');
		} finally {
			busyAction = '';
		}
	}

	async function showCurrent(currentPageIndex: number) {
		busyAction = 'show';
		try {
			const key = keys[currentPageIndex];
			if (!key) {
				throw new Error('Kein Bild ausgewählt.');
			}
			const response = await fetch('/preview/action', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key })
			});
			await parseResponse(response);
			setMessage('Bild an den Rahmen gesendet.');
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'Anzeigen fehlgeschlagen.', 'error');
		} finally {
			busyAction = '';
		}
	}

	function getFlags(key: string): Flags {
		return flagsByKey[key] ?? { favorite: false, skipped: false };
	}

	async function setFlagsForCurrent(currentPageIndex: number, patch: Partial<Flags>) {
		const key = keys[currentPageIndex];
		if (!key) {
			setMessage('Kein Bild ausgewählt.', 'error');
			return;
		}

		const action = patch.favorite !== undefined ? 'favorite' : 'skip';
		busyAction = action;
		try {
			const response = await fetch('/preview/meta', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key, ...patch })
			});
			const json = await parseResponse(response);
			flagsByKey[key] = {
				favorite: json.favorite === true,
				skipped: json.skipped === true
			};
			flagsByKey = flagsByKey;

			if (patch.favorite !== undefined) {
				setMessage(json.favorite === true ? 'Als Favorit markiert.' : 'Favorit entfernt.');
			} else {
				setMessage(json.skipped === true ? 'Als übersprungen markiert.' : 'Überspringen entfernt.');
			}
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.', 'error');
		} finally {
			busyAction = '';
		}
	}
</script>

{#if browser && images.length > 0}
	<section class="preview-wrap">
		<Carousel let:currentPageIndex={index} let:showPrevPage let:showNextPage duration={100}>
			<div slot="prev">
				<button class="nav" on:click={showPrevPage} aria-label="Vorheriges Bild"> &lt; </button>
			</div>
			<div slot="next">
				<button class="nav" on:click={showNextPage} aria-label="Nächstes Bild"> &gt; </button>
			</div>
			<div slot="dots">
				<div class="toolbar">
					<pre>{pageCount > 0 ? `${(index + 1).toString().padStart(pageCount.toString().length, '0')}/${pageCount}` : '0/0'}</pre>
				</div>
				<form on:submit|preventDefault={() => showCurrent(index)}>
					<button type="submit" disabled={busyAction !== ''}>
						{busyAction === 'show' ? 'Sende...' : 'Anzeigen'}
					</button>
					<button
						type="button"
						class:active={getFlags(keys[index]).favorite}
						on:click={() => setFlagsForCurrent(index, { favorite: !getFlags(keys[index]).favorite })}
						disabled={busyAction !== ''}
					>
						{busyAction === 'favorite'
							? 'Speichere...'
							: getFlags(keys[index]).favorite
								? 'Favorit entfernen'
								: 'Als Favorit markieren'}
					</button>
					<button
						type="button"
						class="warn"
						class:active={getFlags(keys[index]).skipped}
						on:click={() => setFlagsForCurrent(index, { skipped: !getFlags(keys[index]).skipped })}
						disabled={busyAction !== ''}
					>
						{busyAction === 'skip'
							? 'Speichere...'
							: getFlags(keys[index]).skipped
								? 'Überspringen entfernen'
								: 'Als übersprungen markieren'}
					</button>
					<button
						type="button"
						class="danger"
						on:click={() => deleteCurrent(index)}
						disabled={busyAction !== ''}
					>
						{busyAction === 'delete' ? 'Lösche...' : 'Löschen'}
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
{:else}
	<p class="msg" data-type="error">Keine Bilder zum Anzeigen.</p>
	<a href="/upload">Bilder hochladen</a>
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

	form > button {
		flex: 1 1 45%;
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

	button.active {
		background: #ecfdf3;
		border-color: #86efac;
		color: #166534;
	}

	button.warn {
		background: #fffbeb;
		border-color: #fcd34d;
		color: #92400e;
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
