<script>
	import { onMount } from 'svelte';

	onMount(async () => {
		const Sentry = await import('@sentry/browser');
		Sentry.init({
			integrations: [new Sentry.BrowserTracing()],
			tracesSampleRate: 1.0,
			replaysOnErrorSampleRate: 0.1
		});
	});
</script>

<main>
	<slot />
</main>

<style lang="scss">
	:global(body) {
		@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@200;500;600;700&display=swap');
		font-family: 'Poppins', sans-serif;
		font-size: 22px;
		background: #89b6c3fa;
		margin: 0;
	}

	@media (max-width: 700px) {
		:global(html) {
			font-size: 18px;
		}
	}

	:global(*) {
		user-select: none;
	}

	:global(button) {
		cursor: pointer;
	}

	main {
		margin-bottom: 5vh;
	}
</style>
