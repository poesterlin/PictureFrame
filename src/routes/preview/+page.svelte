<script lang="ts">
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import Carousel from 'svelte-carousel';

	export let data: PageData;

	async function deleteCurrent(currentPageIndex: number) {
		if (!confirm('wirklich löschen?')) {
			return;
		}

		await fetch('/command', {
			method: 'DELETE',
			body: JSON.stringify({ key: data.keys![currentPageIndex] })
		});
		data.keys!.splice(currentPageIndex, 1);
		data = data;
	}

	async function showCurrent(currentPageIndex: number) {
		await fetch('/command', {
			method: 'POST',
			body: JSON.stringify({ key: data.keys![currentPageIndex] })
		});
	}

	$: images = data.keys?.map((key) => `/preview/toImg?key=${key}`);
</script>

{#if browser && images}
	<section>
		<Carousel
			let:currentPageIndex={index}
			let:pagesCount
			let:showPrevPage
			let:showNextPage
			duration={100}
		>
			<div slot="prev">
				<button class="nav" on:click={showPrevPage}> &lt; </button>
			</div>
			<div slot="next">
				<button class="nav" on:click={showNextPage}> &gt; </button>
			</div>
			<div slot="dots">
				<pre>{(index + 1).toString().padStart(pagesCount.toString().length, '0')}/{pagesCount}</pre>
				<form>
					<button on:click={() => showCurrent(index)}>Anzeigen</button>
					<button class="danger" on:click={() => deleteCurrent(index)}>Löschen</button>
				</form>
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

		filter: saturate(0.4) brightness(1.1) opacity(0.8) blur(1.5px) hue-rotate(11deg);
	}

	section {
		max-width: 800px;
		max-height: 480px;
		margin: auto;
		margin-top: 20px;
	}

	button.nav {
		top: calc(50% - 35px);
		position: relative;
	}
	pre {
		text-align: center;
	}

	form {
		display: flex;
		flex-wrap: wrap;
		width: 600px;
		max-width: 95vw;
		margin: 5vh auto;
	}

	form > button {
		flex: 1 1 33%;
	}

	button {
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
