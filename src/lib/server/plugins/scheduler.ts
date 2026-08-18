import { building } from '$app/environment';
import { db } from '$lib/server/db';
import { pluginInstances } from '$lib/server/db/schema';
import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { runPluginInstance } from './runner';

const SCHEDULER_KEY = '__pictureframe_plugin_scheduler__';
const TICK_INTERVAL_MS = 15_000;
const LOCK_DURATION_MS = 60_000;
const MAX_RUNS_PER_TICK = 2;

type SchedulerState = {
	timer: ReturnType<typeof setInterval>;
	ticking: boolean;
};

async function claimPluginInstance(id: number, now: Date) {
	const [claimed] = await db
		.update(pluginInstances)
		.set({ lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS) })
		.where(
			and(
				eq(pluginInstances.id, id),
				eq(pluginInstances.enabled, true),
				or(isNull(pluginInstances.lockedUntil), lt(pluginInstances.lockedUntil, now))
			)
		)
		.returning();
	return claimed ?? null;
}

export async function runPluginInstanceNow(id: number): Promise<boolean> {
	const instance = await claimPluginInstance(id, new Date());
	if (!instance) return false;
	await runPluginInstance(instance);
	return true;
}

export async function runDuePluginInstances(): Promise<void> {
	const now = new Date();
	const due = await db
		.select({ id: pluginInstances.id })
		.from(pluginInstances)
		.where(
			and(
				eq(pluginInstances.enabled, true),
				or(
					eq(pluginInstances.forceDisplayRequested, true),
					isNull(pluginInstances.nextRunAt),
					lte(pluginInstances.nextRunAt, now)
				),
				or(isNull(pluginInstances.lockedUntil), lt(pluginInstances.lockedUntil, now))
			)
		)
		.orderBy(asc(pluginInstances.nextRunAt))
		.limit(MAX_RUNS_PER_TICK);

	await Promise.all(
		due.map(async ({ id }) => {
			const instance = await claimPluginInstance(id, now);
			if (instance) {
				await runPluginInstance(instance);
			}
		})
	);
}

export function startPluginScheduler(): void {
	if (building || !process.env.DATABASE_URL) return;

	const world = globalThis as typeof globalThis & { [SCHEDULER_KEY]?: SchedulerState };
	if (world[SCHEDULER_KEY]) return;

	const state: SchedulerState = {
		ticking: false,
		timer: setInterval(() => {
			if (state.ticking) return;
			state.ticking = true;
			void runDuePluginInstances()
				.catch((error) => console.error('[plugin] scheduler tick failed:', error))
				.finally(() => {
					state.ticking = false;
				});
		}, TICK_INTERVAL_MS)
	};

	world[SCHEDULER_KEY] = state;
	void runDuePluginInstances().catch((error) =>
		console.error('[plugin] initial scheduler tick failed:', error)
	);
}
