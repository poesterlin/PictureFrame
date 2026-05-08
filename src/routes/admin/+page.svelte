<script lang="ts">
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
				message?: string;
		  }
		| undefined;

	let notice = '';
	let noticeType: 'success' | 'error' = 'success';
	let newClaimCode = '';

	$: if (form?.createdFrame) {
		notice = `Frame erstellt: ${form.createdFrame.frameName}`;
		noticeType = 'success';
	}

	$: if (form?.claimCode) {
		newClaimCode = form.claimCode;
		notice = 'Claim-Code erstellt.';
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
</script>

<section class="admin-wrap">
	<div class="admin-card">
		<h1>Admin</h1>
		<p>Hier kannst du einen Geschenk-Frame vorbereiten, der später per Claim-Code übernommen wird.</p>

		<form method="POST" action="?/createGiftFrame">
			<label for="frameName">Frame-Name</label>
			<input id="frameName" name="frameName" type="text" minlength="2" maxlength="80" required />
			<button type="submit">Geschenk-Frame erstellen</button>
		</form>

		{#if data.frames.length > 0}
			<div class="codes-list">
				{#each data.frames as frame}
					<div class="code-item">
						<div>
							<strong>{frame.frameName}</strong>
							<p>Frame-ID: {frame.id}</p>
						</div>
						<div class="frame-actions">
							<form method="POST" action="?/createClaimCode">
								<input type="hidden" name="frameId" value={frame.id} />
								<label for={`claimTtlHours-${frame.id}`}>Claim-Code gültig (Stunden)</label>
								<input
									id={`claimTtlHours-${frame.id}`}
									type="number"
									name="ttlHours"
									min="1"
									max="720"
									value="336"
								/>
								<button type="submit">Claim-Code erstellen</button>
							</form>
							<form method="POST" action="?/deleteFrame">
								<input type="hidden" name="frameId" value={frame.id} />
								<button type="submit">Frame löschen</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p>Keine unclaimed Frames vorhanden.</p>
		{/if}

		{#if newClaimCode}
			<div class="code-row">
				<code>{newClaimCode}</code>
				<button type="button" on:click={copyClaimCode}>Code kopieren</button>
			</div>
		{/if}

		{#if data.claimCodes.length > 0}
			<div class="codes-list">
				{#each data.claimCodes as code}
					<div class="code-item">
						<div>
							<strong>{code.frameName}</strong>
							<p>
								Ablauf: {formatDate(code.expiresAt)} | Status: {claimStatus(
									code.claimedAt,
									code.disabled,
									code.expiresAt
								)}
							</p>
						</div>
						{#if claimStatus(code.claimedAt, code.disabled, code.expiresAt) === 'active'}
							<form method="POST" action="?/disableClaimCode">
								<input type="hidden" name="codeId" value={code.id} />
								<button type="submit">Code deaktivieren</button>
							</form>
						{:else if claimStatus(code.claimedAt, code.disabled, code.expiresAt) === 'disabled'}
							<form method="POST" action="?/deleteClaimCode">
								<input type="hidden" name="codeId" value={code.id} />
								<button type="submit">Code löschen</button>
							</form>
						{/if}
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
	}

	.admin-card {
		width: min(620px, 100%);
		display: grid;
		gap: 0.8rem;
		padding: clamp(1rem, 3vw, 1.8rem);
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid rgba(15, 23, 42, 0.14);
		box-shadow: 0 24px 52px -38px rgba(0, 0, 0, 0.6);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.4rem, 4vw, 2rem);
	}

	p {
		margin: 0;
		font-size: 0.94rem;
		color: #475569;
	}

	form {
		display: grid;
		gap: 0.55rem;
	}

	label {
		font-size: 0.84rem;
		font-weight: 600;
	}

	input {
		padding: 0.68rem 0.75rem;
		font: inherit;
		font-size: 0.95rem;
		border-radius: 10px;
		border: 1px solid rgba(15, 23, 42, 0.24);
	}

	button {
		font: inherit;
		padding: 0.72rem 0.84rem;
		border-radius: 10px;
		border: 1px solid #0f172a;
		background: #0f172a;
		color: #fff;
	}

	.notice {
		padding: 0.65rem 0.75rem;
		border-radius: 10px;
		font-size: 0.86rem;
		font-weight: 600;
	}

	.codes-list {
		display: grid;
		gap: 0.5rem;
	}

	.code-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.8rem;
		padding: 0.6rem;
		border-radius: 10px;
		border: 1px solid rgba(15, 23, 42, 0.14);
	}

	.frame-actions {
		display: grid;
		gap: 0.45rem;
	}

	.code-item p {
		margin-top: 0.2rem;
		font-size: 0.82rem;
	}

	.code-row {
		display: grid;
		gap: 0.4rem;
	}

	code {
		display: block;
		padding: 0.55rem 0.65rem;
		font-size: 0.82rem;
		background: #eef2ff;
		border-radius: 8px;
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
