<script lang="ts">
	import { page } from '$app/stores';
	export let data: {
		frames: Array<{ id: number; frameName: string }>;
		claimCodes: Array<{
			id: number;
			frameId: number;
			expiresAt: Date;
			claimedAt: Date | null;
			disabled: boolean;
			createdAt: Date;
			frameName: string;
		}>;
	};

	export let form:
		| {
				success?: boolean;
				createdFrame?: { id: number; frameName: string };
				claimCode?: string;
				uploadCode?: string;
				uploadUrl?: string;
				message?: string;
		  }
		| undefined;

	let notice = '';
	let noticeType: 'success' | 'error' = 'success';
	let newClaimCode: string | undefined = undefined;
	let newUploadCode: string | undefined = undefined;

	$: if (form?.createdFrame) {
		notice = `Frame erstellt: ${form.createdFrame.frameName}`;
		noticeType = 'success';
	}

	$: if (form?.claimCode) {
		newClaimCode = new URL(`/register?inviteCode=${form.claimCode}`, $page.url.origin).toString();
		notice = 'Claim-Code erstellt.';
		noticeType = 'success';
	}

	$: if (form?.uploadCode && form?.uploadUrl) {
		newUploadCode = new URL(form.uploadUrl, $page.url.origin).toString();
		notice = 'Upload-Code erstellt.';
		noticeType = 'success';
	}

	$: if (form?.message) {
		notice = form.message;
		noticeType = 'error';
	}

	function formatDate(timestamp: Date) {
		return new Date(timestamp).toLocaleString();
	}

	function isExpired(timestamp: Date) {
		return timestamp.getTime() <= Date.now();
	}

	function claimStatus(claimedAt: Date | null, disabled: boolean, expiresAt: Date) {
		if (claimedAt) return 'claimed';
		if (disabled) return 'disabled';
		if (isExpired(expiresAt)) return 'expired';
		return 'active';
	}

	async function copyClaimCode() {
		if (!newClaimCode) return;
		await navigator.clipboard.writeText(newClaimCode);
		notice = 'Claim-Code in die Zwischenablage kopiert.';
		noticeType = 'success';
	}

	async function copyUploadCode() {
		if (!newUploadCode) return;
		await navigator.clipboard.writeText(newUploadCode);
		notice = 'Upload-Code in die Zwischenablage kopiert.';
		noticeType = 'success';
	}
</script>

<section class="admin-wrap">
	<div class="admin-card">
		<h1>Admin</h1>
		<p class="lede">
			Hier kannst du einen Geschenk-Frame vorbereiten, der später per Claim-Code übernommen wird.
		</p>

		<form method="POST" action="?/createGiftFrame" class="row">
			<label for="frameName">Frame-Name</label>
			<input id="frameName" name="frameName" type="text" minlength="2" maxlength="80" required />
			<button type="submit" class="primary">Geschenk-Frame erstellen</button>
		</form>

		{#if newClaimCode}
			<div class="code-row">
				<code>{newClaimCode}</code>
				<button type="button" class="ghost" on:click={copyClaimCode}>Kopieren</button>
			</div>
		{/if}

		{#if newUploadCode}
			<div class="code-row">
				<code>{newUploadCode}</code>
				<button type="button" class="ghost" on:click={copyUploadCode}>Kopieren</button>
			</div>
		{/if}

		<h2>Unclaimed Frames</h2>
		{#if data.frames.length > 0}
			<div class="codes-list">
				{#each data.frames as frame}
					<div class="frame-item">
						<div class="frame-info">
							<strong>{frame.frameName}</strong>
							<span class="muted">ID: {frame.id}</span>
						</div>
					<div class="frame-actions">
						<form method="POST" action="?/createClaimCode" class="inline">
							<input
								id={`claimTtlHours-${frame.id}`}
								type="number"
								name="ttlHours"
								min="1"
								max="720"
								value="336"
								title="Gültig (Stunden)"
							/>
							<input type="hidden" name="frameId" value={frame.id} />
							<button type="submit">Claim-Code</button>
						</form>
							<form method="POST" action="?/createUploadCode" class="inline">
								<input type="hidden" name="frameId" value={frame.id} />
								<button type="submit">Upload-Code</button>
							</form>
							<form method="POST" action="?/deleteFrame" class="inline">
								<input type="hidden" name="frameId" value={frame.id} />
								<button type="submit" class="danger">Löschen</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="muted">Keine unclaimed Frames vorhanden.</p>
		{/if}

		{#if data.claimCodes.length > 0}
			<h2>Claim-Codes</h2>
			<div class="codes-list">
				{#each data.claimCodes as code}
					<div class="frame-item">
						<div class="frame-info">
							<strong>{code.frameName}</strong>
							<span class="muted">
								Ablauf: {formatDate(code.expiresAt)} · Status: {claimStatus(
									code.claimedAt,
									code.disabled,
									code.expiresAt
								)}
							</span>
						</div>
						<div class="frame-actions">
							{#if claimStatus(code.claimedAt, code.disabled, code.expiresAt) === 'active'}
								<form method="POST" action="?/disableClaimCode" class="inline">
									<input type="hidden" name="codeId" value={code.id} />
									<button type="submit">Deaktivieren</button>
								</form>
							{:else if claimStatus(code.claimedAt, code.disabled, code.expiresAt) === 'disabled'}
								<form method="POST" action="?/deleteClaimCode" class="inline">
									<input type="hidden" name="codeId" value={code.id} />
									<button type="submit" class="danger">Löschen</button>
								</form>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if notice}
			<p class="notice {noticeType}">{notice}</p>
		{/if}
	</div>
</section>

<style>
	.admin-wrap {
		display: grid;
		place-items: center;
		padding: clamp(1rem, 4vw, 2rem);
		font-size: 14px;
	}

	.admin-card {
		width: min(720px, 100%);
		display: grid;
		gap: 1rem;
		padding: clamp(1rem, 3vw, 1.6rem);
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid rgba(15, 23, 42, 0.14);
		box-shadow: 0 24px 52px -38px rgba(0, 0, 0, 0.6);
	}

	h1 {
		margin: 0;
		font-size: 1.4rem;
	}

	h2 {
		margin: 0.5rem 0 0;
		font-size: 1rem;
		color: #334155;
	}

	.lede {
		margin: 0;
		color: #475569;
	}

	.muted {
		color: #64748b;
		font-size: 0.85rem;
	}

	form.row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.5rem;
	}

	form.inline {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
	}

	label {
		font-size: 0.85rem;
		font-weight: 600;
	}

	input {
		padding: 0.45rem 0.6rem;
		font-family: inherit;
		font-size: 0.9rem;
		border-radius: 8px;
		border: 1px solid rgba(15, 23, 42, 0.24);
		background: #fff;
	}

	input[type='number'] {
		width: 5.5rem;
	}

	button {
		font-family: inherit;
		font-size: 0.85rem;
		padding: 0.45rem 0.75rem;
		border-radius: 8px;
		border: 1px solid #0f172a;
		background: #0f172a;
		color: #fff;
		white-space: nowrap;
	}

	button.primary {
		background: #0f172a;
	}

	button.ghost {
		background: #fff;
		color: #0f172a;
		border-color: rgba(15, 23, 42, 0.24);
	}

	button.danger {
		background: #b91c1c;
		border-color: #b91c1c;
	}

	.notice {
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 600;
		margin: 0;
	}

	.codes-list {
		display: grid;
		gap: 0.5rem;
	}

	.frame-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		border: 1px solid rgba(15, 23, 42, 0.14);
		background: #fafafa;
		flex-wrap: wrap;
	}

	.frame-info {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}

	.frame-info strong {
		font-size: 0.95rem;
	}

	.frame-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.code-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	code {
		display: block;
		flex: 1;
		padding: 0.45rem 0.6rem;
		font-size: 0.8rem;
		background: #eef2ff;
		border-radius: 8px;
		word-break: break-all;
	}

	.notice.success {
		background: #ecfdf3;
		border: 1px solid #86efac;
		color: #166534;
	}

	.notice.error {
		background: #fff1f2;
		border: 1px solid #fda4af;
		color: #9f1239;
	}
</style>
