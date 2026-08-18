import { db } from '$lib/server/db';
import {
	pictureFrames,
	pictures,
	pluginInstances,
	type PluginInstance
} from '$lib/server/db/schema';
import { publishPicture } from '$lib/server/device/display';
import { pickRandomPictureForFrame } from '$lib/server/device/picker';
import { encodeImageAsFrame } from '$lib/server/frame-image';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { storeFrameArtifacts } from '../../../../realtime/frame-storage.js';
import { hashPluginValue } from './hash';
import { getContentPlugin } from './registry';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;

function nextPollAt(instance: PluginInstance, now: Date, nextEvaluationAt?: Date) {
	const pollAt = new Date(now.getTime() + Math.max(30, instance.pollEverySeconds) * 1000);
	if (nextEvaluationAt && nextEvaluationAt > now && nextEvaluationAt < pollAt) {
		return nextEvaluationAt;
	}
	return pollAt;
}

async function fetchJson(endpointUrl: string): Promise<unknown> {
	const url = new URL(endpointUrl);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Plugin endpoint must use HTTP or HTTPS');
	}

	const response = await fetch(url, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`Plugin endpoint returned HTTP ${response.status}`);
	}

	const declaredLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		throw new Error('Plugin response is larger than 1 MiB');
	}

	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > MAX_RESPONSE_BYTES) {
		throw new Error('Plugin response is larger than 1 MiB');
	}

	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new Error('Plugin endpoint did not return valid JSON');
	}
}

async function publishFallback(frameId: number) {
	const fallback = await pickRandomPictureForFrame(frameId);
	if (!fallback) return;
	await publishPicture({
		frameId,
		pictureId: fallback.pictureId,
		artifactKey: fallback.artifactKey
	});
}

async function recordFailure(instance: PluginInstance, error: unknown) {
	const now = new Date();
	const failureCount = instance.consecutiveFailures + 1;
	const backoffSeconds = Math.min(
		MAX_BACKOFF_SECONDS,
		Math.max(30, instance.pollEverySeconds) * Math.pow(2, Math.min(failureCount - 1, 6))
	);
	const message = error instanceof Error ? error.message : String(error);

	await db
		.update(pluginInstances)
		.set({
			lockedUntil: null,
			nextRunAt: new Date(now.getTime() + backoffSeconds * 1000),
			lastStatus: 'error',
			lastError: message.slice(0, 2000),
			consecutiveFailures: failureCount,
			updatedAt: now
		})
		.where(eq(pluginInstances.id, instance.id));

	console.error(`[plugin] instance=${instance.id} key=${instance.pluginKey} failed:`, message);
}

export async function runPluginInstance(
	instance: PluginInstance,
	options: { forceDisplay?: boolean } = {}
): Promise<void> {
	const plugin = getContentPlugin(instance.pluginKey);
	if (!plugin) {
		await recordFailure(instance, new Error(`Unknown plugin: ${instance.pluginKey}`));
		return;
	}

	try {
		const now = new Date();
		const input = plugin.fetchInput
			? await plugin.fetchInput(instance.endpointUrl)
			: await fetchJson(instance.endpointUrl);
		const config = plugin.configSchema.parse(instance.config);
		const normalizedData = plugin.normalize(input);
		const evaluation = await plugin.evaluate(normalizedData, { config, now });
		const sourceHash = hashPluginValue(normalizedData);
		const meaningfulHash = hashPluginValue(evaluation.meaningfulData);
		const renderHash = hashPluginValue({
			config,
			meaningfulHash,
			pluginKey: plugin.key,
			pluginVersion: plugin.version
		});
		const nextRunAt = nextPollAt(instance, now, evaluation.nextEvaluationAt);

		const [currentFrame] = await db
			.select({ currentPictureId: pictureFrames.currentPictureId })
			.from(pictureFrames)
			.where(eq(pictureFrames.id, instance.frameId))
			.limit(1);
		const [existingPicture] = await db
			.select({
				id: pictures.id,
				artifactKey: pictures.fileName,
				eligible: pictures.eligible
			})
			.from(pictures)
			.where(and(eq(pictures.pluginInstanceId, instance.id), isNull(pictures.supersededAt)))
			.orderBy(desc(pictures.createdAt))
			.limit(1);

		if (!evaluation.active) {
			await db
				.update(pictures)
				.set({ eligible: false })
				.where(eq(pictures.pluginInstanceId, instance.id));
			await db
				.update(pluginInstances)
				.set({
					lockedUntil: null,
					nextRunAt,
					lastFetchedAt: now,
					lastSuccessAt: now,
					lastSourceHash: sourceHash,
					lastMeaningfulHash: meaningfulHash,
					lastStatus: 'inactive',
					lastError: null,
					consecutiveFailures: 0,
					updatedAt: now
				})
				.where(eq(pluginInstances.id, instance.id));

			if (existingPicture?.id === currentFrame?.currentPictureId) {
				await publishFallback(instance.frameId);
			}
			return;
		}

		const canReuseExisting =
			instance.compareMeaningfulChanges &&
			instance.lastMeaningfulHash === meaningfulHash &&
			instance.lastRenderHash === renderHash &&
			existingPicture;

		if (canReuseExisting) {
			if (!existingPicture.eligible) {
				await db
					.update(pictures)
					.set({ eligible: true })
					.where(eq(pictures.id, existingPicture.id));
				if (instance.displayMode === 'immediate' && !options.forceDisplay) {
					await publishPicture({
						frameId: instance.frameId,
						pictureId: existingPicture.id,
						artifactKey: existingPicture.artifactKey
					});
				}
			}
			if (options.forceDisplay) {
				await publishPicture({
					frameId: instance.frameId,
					pictureId: existingPicture.id,
					artifactKey: existingPicture.artifactKey
				});
			}

			await db
				.update(pluginInstances)
				.set({
					lockedUntil: null,
					nextRunAt,
					lastFetchedAt: now,
					lastSuccessAt: now,
					lastSourceHash: sourceHash,
					lastStatus: 'unchanged',
					lastError: null,
					consecutiveFailures: 0,
					updatedAt: now
				})
				.where(eq(pluginInstances.id, instance.id));
			return;
		}

		if (evaluation.model === undefined) {
			throw new Error('Active plugin did not provide a render model');
		}

		const renderedImage = await plugin.render(evaluation.model, { config });
		const encodedFrame = await encodeImageAsFrame(renderedImage);
		const requestId = crypto.randomUUID();
		const stored = await storeFrameArtifacts(
			`frame-${instance.frameId}-plugin-${instance.id}`,
			requestId,
			Buffer.from(encodedFrame.indexedPixels),
			encodedFrame.artifact
		);

		const [createdPicture] = await db.transaction(async (transaction) => {
			await transaction
				.update(pictures)
				.set({ eligible: false, supersededAt: now })
				.where(eq(pictures.pluginInstanceId, instance.id));

			const inserted = await transaction
				.insert(pictures)
				.values({
					frameId: instance.frameId,
					uploaderName: `Plugin: ${plugin.label}`,
					fileName: stored.artifactKey,
					sourceType: 'plugin',
					pluginInstanceId: instance.id,
					contentHash: renderHash,
					eligible: true,
					favorite: false,
					skipped: false,
					createdAt: now
				})
				.returning({ id: pictures.id, artifactKey: pictures.fileName });

			await transaction
				.update(pluginInstances)
				.set({
					lockedUntil: null,
					nextRunAt,
					lastFetchedAt: now,
					lastSuccessAt: now,
					lastSourceHash: sourceHash,
					lastMeaningfulHash: meaningfulHash,
					lastRenderHash: renderHash,
					lastStatus: 'rendered',
					lastError: null,
					consecutiveFailures: 0,
					updatedAt: now
				})
				.where(eq(pluginInstances.id, instance.id));

			return inserted;
		});

		if (!createdPicture) {
			throw new Error('Plugin image record was not created');
		}

		if (
			options.forceDisplay ||
			instance.displayMode === 'immediate' ||
			!currentFrame?.currentPictureId
		) {
			await publishPicture({
				frameId: instance.frameId,
				pictureId: createdPicture.id,
				artifactKey: createdPicture.artifactKey,
				requestId
			});
		}

		console.log(
			`[plugin] instance=${instance.id} key=${plugin.key} rendered ${createdPicture.artifactKey}`
		);
	} catch (error) {
		await recordFailure(instance, error);
	}
}
