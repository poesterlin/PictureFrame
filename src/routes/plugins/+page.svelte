<script lang="ts">
	import type { PluginCatalogEntry } from '$lib/plugins/catalog';

	export let data: {
		frame: { id: number; frameName: string } | null;
		frames: Array<{ id: number; frameName: string }>;
		isAdmin: boolean;
		catalog: PluginCatalogEntry[];
		instances: Array<{
			id: number;
			pluginKey: string;
			name: string;
			endpointUrl: string;
			enabled: boolean;
			pollEverySeconds: number;
			displayMode: string;
			config: Record<string, unknown>;
			lastStatus: string | null;
			lastError: string | null;
			lastSuccessAt: Date | null;
			consecutiveFailures: number;
		}>;
	};
	export let form:
		| { saved?: boolean; deleted?: boolean; ranNow?: boolean; message?: string }
		| undefined;

	let selectedKey = data.catalog[0]?.key ?? '';
	let editingId = 0;
	let name = '';
	let endpointUrl = '';
	let enabled = true;
	let pollEverySeconds = 900;
	let displayMode = 'rotation';
	let config: Record<string, unknown> = {};

	$: selected = data.catalog.find((plugin) => plugin.key === selectedKey) ?? data.catalog[0];
	$: if (!editingId && selected && Object.keys(config).length === 0) resetDraft(selected);

	function resetDraft(plugin: PluginCatalogEntry) {
		selectedKey = plugin.key;
		editingId = 0;
		name = plugin.label;
		endpointUrl = plugin.defaultEndpoint;
		enabled = true;
		pollEverySeconds = 900;
		displayMode = 'rotation';
		config = { ...plugin.defaultConfig };
	}

	function choosePlugin(key: string) {
		const plugin = data.catalog.find((entry) => entry.key === key);
		if (plugin) resetDraft(plugin);
	}

	function edit(instance: (typeof data.instances)[number]) {
		selectedKey = instance.pluginKey;
		editingId = instance.id;
		name = instance.name;
		endpointUrl = instance.endpointUrl;
		enabled = instance.enabled;
		pollEverySeconds = instance.pollEverySeconds;
		displayMode = instance.displayMode;
		config = { ...instance.config };
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function setConfig(key: string, value: unknown) {
		config = { ...config, [key]: value };
	}

	function statusLabel(status: string | null) {
		return status ? status.replaceAll('_', ' ') : 'Waiting for first run';
	}

	function formatDate(date: Date | null) {
		return date
			? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
					new Date(date)
				)
			: 'Never';
	}
</script>

<svelte:head><title>Content plugins</title></svelte:head>

<div class="page-shell">
	<header class="page-header">
		<div>
			<a class="back" href="/settings">← Settings</a>
			<p class="eyebrow">CONTENT AUTOMATION</p>
			<h1>Plugins</h1>
			<p>Keep your frame useful with events and live transport information.</p>
		</div>
		{#if data.frame}<span class="frame-pill">{data.frame.frameName}</span>{/if}
	</header>
	{#if data.isAdmin && data.frames.length > 0}
		<form class="frame-picker" method="GET" action="/plugins">
			<label for="plugin-frame">Working on frame</label>
			<select
				id="plugin-frame"
				name="frameId"
				value={data.frame?.id}
				on:change={(event) => event.currentTarget.form?.submit()}
			>
				{#each data.frames as frame}<option value={frame.id}>{frame.frameName}</option>{/each}
			</select>
		</form>
	{/if}

	{#if form?.message}<div class="notice error">{form.message}</div>{/if}
	{#if form?.saved}<div class="notice success">Plugin saved. It will refresh shortly.</div>{/if}
	{#if form?.ranNow}<div class="notice success">Plugin finished running.</div>{/if}

	{#if !data.frame}
		<section class="empty">
			<h2>No frame connected</h2>
			<p>Connect a frame before adding plugins.</p>
		</section>
	{:else}
		<div class="workspace">
			<section class="editor">
				<div class="section-heading">
					<div>
						<p class="step">01</p>
						<h2>{editingId ? 'Edit plugin' : 'Add a plugin'}</h2>
					</div>
					{#if editingId}<button class="quiet" type="button" on:click={() => resetDraft(selected)}
							>Cancel</button
						>{/if}
				</div>

				<div class="plugin-picker">
					{#each data.catalog as plugin}
						<button
							class:active={selectedKey === plugin.key}
							type="button"
							on:click={() => choosePlugin(plugin.key)}
						>
							<span>{plugin.city}</span><strong>{plugin.label}</strong><small
								>{plugin.description}</small
							>
						</button>
					{/each}
				</div>

				{#if selected}
					<form method="POST" action="?/save" class="config-form">
						<input type="hidden" name="id" value={editingId} />
						<input type="hidden" name="frameId" value={data.frame.id} />
						<input type="hidden" name="pluginKey" value={selected.key} />
						<input type="hidden" name="config" value={JSON.stringify(config)} />

						<div class="field wide">
							<label for="name">Name</label><input
								id="name"
								name="name"
								bind:value={name}
								required
								maxlength="80"
							/>
						</div>
						{#each selected.fields as field}
							<div class:wide={field.type === 'text' || field.type === 'list'} class="field">
								{#if field.type === 'boolean'}
									<label class="switch"
										><input
											type="checkbox"
											checked={Boolean(config[field.key])}
											on:change={(event) => setConfig(field.key, event.currentTarget.checked)}
										/><span></span>{field.label}</label
									>
								{:else if field.type === 'select'}
									<label for={field.key}>{field.label}</label><select
										id={field.key}
										value={String(config[field.key] ?? '')}
										on:change={(event) => setConfig(field.key, event.currentTarget.value)}
										>{#each field.options ?? [] as option}<option value={option}>{option}</option
											>{/each}</select
									>
								{:else if field.type === 'number'}
									<label for={field.key}>{field.label}</label><input
										id={field.key}
										type="number"
										min={field.min}
										max={field.max}
										value={Number(config[field.key])}
										on:input={(event) => setConfig(field.key, Number(event.currentTarget.value))}
									/>
								{:else}
									<label for={field.key}>{field.label}</label><input
										id={field.key}
										value={field.type === 'list'
											? ((config[field.key] as string[]) ?? []).join(', ')
											: String(config[field.key] ?? '')}
										on:input={(event) =>
											setConfig(
												field.key,
												field.type === 'list'
													? event.currentTarget.value
															.split(',')
															.map((item) => item.trim())
															.filter(Boolean)
													: event.currentTarget.value
											)}
									/>
								{/if}
								{#if field.help}<small>{field.help}</small>{/if}
							</div>
						{/each}

						<details class="advanced wide">
							<summary>Advanced</summary>
							<div class="advanced-grid">
								<div class="field wide">
									<label for="endpoint">Data endpoint</label><input
										id="endpoint"
										name="endpointUrl"
										bind:value={endpointUrl}
										required
									/>
								</div>
								<div class="field">
									<label for="poll">Refresh every (seconds)</label><input
										id="poll"
										name="pollEverySeconds"
										type="number"
										min="60"
										max="21600"
										bind:value={pollEverySeconds}
									/>
								</div>
								<div class="field">
									<label for="mode">Display behavior</label><select
										id="mode"
										name="displayMode"
										bind:value={displayMode}
										><option value="rotation">Join rotation</option><option value="immediate"
											>Show immediately</option
										></select
									>
								</div>
							</div>
						</details>
						<label class="switch wide"
							><input type="checkbox" name="enabled" bind:checked={enabled} /><span
							></span>Enabled</label
						>
						<button class="primary wide" type="submit"
							>{editingId ? 'Save changes' : 'Add plugin'}</button
						>
					</form>
				{/if}
			</section>

			<section class="instances">
				<div class="section-heading">
					<div>
						<p class="step">02</p>
						<h2>Your plugins</h2>
					</div>
					<span>{data.instances.length}</span>
				</div>
				{#if data.instances.length === 0}<div class="empty compact">
						<p>No plugins yet. Choose one from the left.</p>
					</div>{/if}
				{#each data.instances as instance}
					<article class="instance" class:disabled={!instance.enabled}>
						<div class="instance-top">
							<div>
								<span class="status" data-status={instance.lastStatus ?? 'waiting'}></span>
								<h3>{instance.name}</h3>
							</div>
							<span class="state">{instance.enabled ? 'ON' : 'OFF'}</span>
						</div>
						<p class="kind">
							{data.catalog.find((plugin) => plugin.key === instance.pluginKey)?.label ??
								instance.pluginKey}
						</p>
						<div class="metrics">
							<div><small>Status</small><strong>{statusLabel(instance.lastStatus)}</strong></div>
							<div>
								<small>Last success</small><strong>{formatDate(instance.lastSuccessAt)}</strong>
							</div>
						</div>
						{#if instance.lastError}<p class="instance-error">{instance.lastError}</p>{/if}
						<div class="actions">
							<button type="button" on:click={() => edit(instance)}>Configure</button>
							<form method="POST" action="?/runNow">
								<input type="hidden" name="id" value={instance.id} />
								<input type="hidden" name="frameId" value={data.frame.id} />
								<button class="run" type="submit" disabled={!instance.enabled}>Run now</button>
							</form>
							<form method="POST" action="?/toggle">
								<input type="hidden" name="id" value={instance.id} />
								<input type="hidden" name="frameId" value={data.frame.id} /><input
									type="hidden"
									name="enabled"
									value={String(!instance.enabled)}
								/><button type="submit">{instance.enabled ? 'Disable' : 'Enable'}</button>
							</form>
							<form
								method="POST"
								action="?/delete"
								on:submit={(event) =>
									!confirm(`Delete ${instance.name}?`) && event.preventDefault()}
							>
								<input type="hidden" name="id" value={instance.id} />
								<input type="hidden" name="frameId" value={data.frame.id} /><button
									class="danger"
									type="submit">Delete</button
								>
							</form>
						</div>
					</article>
				{/each}
			</section>
		</div>
	{/if}
</div>

<style>
	:global(body) {
		background: #f3f1ea;
		color: #171714;
	}
	.page-shell {
		width: min(1180px, 100%);
		margin: 0 auto;
		padding: clamp(1rem, 4vw, 3rem);
		font-size: 16px;
	}
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 2rem;
		padding: 1rem 0 2rem;
		border-bottom: 2px solid #171714;
	}
	.page-header h1 {
		margin: 0.15rem 0;
		font-size: clamp(2.7rem, 8vw, 5.8rem);
		line-height: 0.9;
		letter-spacing: -0.07em;
	}
	.page-header p {
		margin: 0.6rem 0 0;
		color: #605f58;
	}
	.back {
		color: inherit;
		font-weight: 700;
		text-decoration: none;
	}
	.eyebrow,
	.step {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		color: #3f5bd8 !important;
	}
	.frame-pill,
	.state {
		border: 1px solid #171714;
		border-radius: 999px;
		padding: 0.45rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.frame-picker {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.7rem;
		margin: 1rem 0;
	}
	.frame-picker label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.frame-picker select {
		width: auto;
		min-width: 240px;
	}
	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.8fr);
		gap: 1.25rem;
		margin-top: 1.25rem;
		align-items: start;
	}
	.editor,
	.instances {
		background: #fff;
		border: 1px solid #c9c7bf;
		border-radius: 18px;
		padding: clamp(1rem, 3vw, 1.5rem);
		box-shadow: 0 18px 50px -38px #000;
	}
	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}
	.section-heading h2,
	.section-heading p {
		margin: 0;
	}
	.section-heading > span {
		font-size: 2rem;
		font-weight: 700;
	}
	.plugin-picker {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.6rem;
		margin-bottom: 1.3rem;
	}
	.plugin-picker button {
		display: grid;
		gap: 0.3rem;
		text-align: left;
		padding: 0.9rem;
		border: 1px solid #d5d3cc;
		border-radius: 12px;
		background: #faf9f5;
		color: inherit;
	}
	.plugin-picker button.active {
		border-color: #3f5bd8;
		box-shadow: inset 0 0 0 1px #3f5bd8;
		background: #f0f2ff;
	}
	.plugin-picker span,
	.kind {
		color: #3f5bd8;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.plugin-picker strong {
		font-size: 0.95rem;
	}
	.plugin-picker small {
		color: #686760;
		line-height: 1.35;
	}
	.config-form,
	.advanced-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.9rem;
	}
	.field {
		display: grid;
		gap: 0.35rem;
		align-content: start;
	}
	.wide {
		grid-column: 1 / -1;
	}
	label {
		font-size: 0.75rem;
		font-weight: 700;
	}
	input,
	select {
		width: 100%;
		border: 1px solid #bbb9b1;
		border-radius: 9px;
		background: #fff;
		padding: 0.68rem 0.72rem;
		font: inherit;
		font-size: 0.88rem;
	}
	.field small {
		color: #73716a;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 42px;
	}
	.switch input {
		width: 1px;
		position: absolute;
		opacity: 0;
	}
	.switch span {
		width: 38px;
		height: 22px;
		border-radius: 99px;
		background: #aaa;
		padding: 3px;
		transition: 0.15s;
	}
	.switch span::after {
		content: '';
		display: block;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		transition: 0.15s;
	}
	.switch input:checked + span {
		background: #3f5bd8;
	}
	.switch input:checked + span::after {
		transform: translateX(16px);
	}
	.advanced {
		border-top: 1px solid #dedcd5;
		border-bottom: 1px solid #dedcd5;
		padding: 0.75rem 0;
	}
	.advanced summary {
		cursor: pointer;
		font-weight: 700;
	}
	.advanced-grid {
		margin-top: 0.9rem;
	}
	button {
		font: inherit;
		cursor: pointer;
	}
	.primary {
		border: 0;
		border-radius: 10px;
		padding: 0.8rem 1rem;
		background: #171714;
		color: white;
		font-weight: 700;
	}
	.quiet {
		border: 0;
		background: none;
		text-decoration: underline;
	}
	.instance {
		border-top: 1px solid #d8d6cf;
		padding: 1rem 0;
	}
	.instance:first-of-type {
		border-top: 0;
	}
	.instance.disabled {
		opacity: 0.58;
	}
	.instance-top,
	.instance-top > div,
	.actions {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}
	.instance-top {
		justify-content: space-between;
	}
	.instance h3 {
		margin: 0;
		font-size: 1rem;
	}
	.status {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #e9aa28;
	}
	.status[data-status='rendered'],
	.status[data-status='unchanged'] {
		background: #1a9b61;
	}
	.status[data-status='error'] {
		background: #d43b44;
	}
	.kind {
		margin: 0.4rem 0 0.8rem;
	}
	.metrics {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		padding: 0.75rem;
		border-radius: 9px;
		background: #f5f4ef;
	}
	.metrics div {
		display: grid;
		gap: 0.15rem;
	}
	.metrics small {
		color: #77756e;
	}
	.metrics strong {
		font-size: 0.75rem;
		text-transform: capitalize;
	}
	.actions {
		margin-top: 0.8rem;
		flex-wrap: wrap;
	}
	.actions form {
		display: contents;
	}
	.actions button {
		border: 1px solid #bbb9b1;
		border-radius: 8px;
		background: white;
		padding: 0.45rem 0.65rem;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.actions .danger {
		color: #ac1c2b;
	}
	.actions .run {
		background: #171714;
		border-color: #171714;
		color: white;
	}
	.actions button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	.instance-error,
	.notice {
		padding: 0.65rem;
		border-radius: 8px;
		font-size: 0.75rem;
	}
	.instance-error,
	.notice.error {
		background: #fff0f0;
		color: #9a2430;
	}
	.notice.success {
		background: #e9f8ef;
		color: #16633e;
	}
	.notice {
		margin: 1rem 0;
	}
	.empty {
		padding: 2rem;
		border: 1px dashed #aaa79e;
		border-radius: 14px;
		text-align: center;
	}
	.empty.compact {
		padding: 1rem;
	}
	@media (max-width: 850px) {
		.workspace {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 560px) {
		.plugin-picker,
		.config-form,
		.advanced-grid {
			grid-template-columns: 1fr;
		}
		.wide {
			grid-column: auto;
		}
		.page-header {
			align-items: start;
			flex-direction: column;
		}
	}
</style>
