import { pluginCatalog, getPluginCatalogEntry } from '$lib/plugins/catalog';
import { db } from '$lib/server/db';
import { pluginInstances } from '$lib/server/db/schema';
import {
	activeFrameIdFrom,
	canAccessFrame,
	resolveAccessibleFrame,
	setActiveFrameCookie
} from '$lib/server/frame-access';
import { getContentPlugin } from '$lib/server/plugins/registry';
import { runPluginInstanceNow } from '$lib/server/plugins/scheduler';
import { fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

function parseConfig(pluginKey: string, value: FormDataEntryValue | null) {
	const plugin = getContentPlugin(pluginKey);
	if (!plugin) throw new Error('Unknown plugin');
	const raw = JSON.parse(String(value || '{}'));
	return plugin.configSchema.parse(raw) as Record<string, unknown>;
}

function endpointFor(value: string, origin: string) {
	const url = new URL(value, origin);
	if (!['http:', 'https:'].includes(url.protocol))
		throw new Error('Endpoint must use HTTP or HTTPS');
	return url.toString();
}

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user) throw redirect(302, '/login?redirect=%2Fplugins');
	const requestedId = activeFrameIdFrom(cookies, Number(url.searchParams.get('frameId')) || null);
	const { frame, frames, isAdmin } = await resolveAccessibleFrame(locals.user, requestedId);
	if (isAdmin && frame) setActiveFrameCookie(cookies, frame.id, url.protocol === 'https:');
	const instances = frame
		? await db.select().from(pluginInstances).where(eq(pluginInstances.frameId, frame.id))
		: [];
	return { frame, frames, isAdmin, instances, catalog: pluginCatalog };
};

export const actions: Actions = {
	save: async ({ request, locals, url }) => {
		if (!locals.user) return fail(401, { message: 'Unauthorized' });
		const form = await request.formData();
		const frame = await canAccessFrame(locals.user, Number(form.get('frameId')));
		if (!frame) return fail(403, { message: 'Frame not available' });
		const id = Number(form.get('id') || 0);
		const pluginKey = String(form.get('pluginKey') || '');
		const catalogEntry = getPluginCatalogEntry(pluginKey);
		if (!catalogEntry) return fail(400, { message: 'Unknown plugin' });

		try {
			const now = new Date();
			const values = {
				pluginKey,
				name: String(form.get('name') || catalogEntry.label)
					.trim()
					.slice(0, 80),
				endpointUrl: endpointFor(
					String(form.get('endpointUrl') || catalogEntry.defaultEndpoint),
					url.origin
				),
				enabled: form.get('enabled') === 'on',
				pollEverySeconds: Math.max(
					60,
					Math.min(21_600, Number(form.get('pollEverySeconds') || 900))
				),
				compareMeaningfulChanges: true,
				displayMode: form.get('displayMode') === 'rotation' ? 'rotation' : 'immediate',
				config: parseConfig(pluginKey, form.get('config')),
				nextRunAt: now,
				updatedAt: now
			};

			if (id > 0) {
				const updated = await db
					.update(pluginInstances)
					.set(values)
					.where(and(eq(pluginInstances.id, id), eq(pluginInstances.frameId, frame.id)))
					.returning({ id: pluginInstances.id });
				if (!updated.length) return fail(404, { message: 'Plugin instance not found' });
			} else {
				await db.insert(pluginInstances).values({ ...values, frameId: frame.id, createdAt: now });
			}
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Invalid configuration'
			});
		}
		return { saved: true };
	},

	toggle: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Unauthorized' });
		const form = await request.formData();
		const frame = await canAccessFrame(locals.user, Number(form.get('frameId')));
		if (!frame) return fail(403, { message: 'Frame not available' });
		const id = Number(form.get('id'));
		const enabled = form.get('enabled') === 'true';
		await db
			.update(pluginInstances)
			.set({ enabled, nextRunAt: new Date(), updatedAt: new Date() })
			.where(and(eq(pluginInstances.id, id), eq(pluginInstances.frameId, frame.id)));
		return { toggled: true };
	},

	runNow: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Unauthorized' });
		const form = await request.formData();
		const frame = await canAccessFrame(locals.user, Number(form.get('frameId')));
		if (!frame) return fail(403, { message: 'Frame not available' });
		const id = Number(form.get('id'));
		const [instance] = await db
			.select({ id: pluginInstances.id, enabled: pluginInstances.enabled })
			.from(pluginInstances)
			.where(and(eq(pluginInstances.id, id), eq(pluginInstances.frameId, frame.id)))
			.limit(1);
		if (!instance) return fail(404, { message: 'Plugin instance not found' });
		if (!instance.enabled) return fail(400, { message: 'Enable the plugin before running it' });
		const ran = await runPluginInstanceNow(instance.id);
		if (!ran) return fail(409, { message: 'Plugin is already running' });
		return { ranNow: true };
	},

	delete: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Unauthorized' });
		const form = await request.formData();
		const frame = await canAccessFrame(locals.user, Number(form.get('frameId')));
		if (!frame) return fail(403, { message: 'Frame not available' });
		const id = Number(form.get('id'));
		await db
			.delete(pluginInstances)
			.where(and(eq(pluginInstances.id, id), eq(pluginInstances.frameId, frame.id)));
		return { deleted: true };
	}
};
