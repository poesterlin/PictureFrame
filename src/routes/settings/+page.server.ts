import {
	resolveDeviceId,
	type DeviceCommandMessage,
	type DisplayUpdateMessage
} from '$lib/device-contract';
import type { Actions } from './$types';
import type { ISettings } from './settings';
import { getDeviceBus } from '../../../realtime/device-bus.js';
import { pickRandomArtifactKey } from '../../../realtime/frame-storage.js';


export const prerender = false;
const bus = getDeviceBus();

export const actions: Actions = {
	default: async ({ request }: { request: Request }) => {
		const form = await request.formData();
		const values = JSON.parse(form.get('json') as string) as ISettings;

		if (!values || typeof values !== 'object') {
			return;
		}

		const deviceId = resolveDeviceId(values.deviceId);
		const settings: DeviceCommandMessage = {
			type: 'command',
			deviceId
		};

		if (typeof values.deleteCurrent === 'boolean') {
			settings.deleteCurrent = values.deleteCurrent;
		}

		if (typeof values.reboot === 'boolean') {
			settings.reboot = values.reboot;
		}

		if (typeof values.refreshEvery === 'number') {
			settings.refreshEvery = values.refreshEvery;
		}

		if (typeof values.clearLog === 'boolean') {
			settings.clearLog = values.clearLog;
		}

		const shouldPushRandomFrame = values.refreshNow === true || values.syncNow === true;
		if (shouldPushRandomFrame) {
			const artifactKey = await pickRandomArtifactKey();
			if (artifactKey) {
				const displayMessage: DisplayUpdateMessage = {
					type: 'display',
					deviceId,
					requestId: crypto.randomUUID(),
					createdAt: new Date().toISOString(),
					artifactKey
				};
				bus.publishDisplay(displayMessage);
			}
		}

		const hasCommandBody =
			typeof settings.refreshEvery === 'number' ||
			typeof settings.reboot === 'boolean' ||
			typeof settings.deleteCurrent === 'boolean' ||
			typeof settings.clearLog === 'boolean';

		if (hasCommandBody) {
			console.log(settings);
			bus.publishCommand(settings);
		}
	}
};
