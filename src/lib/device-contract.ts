export const DEVICE_PROTOCOL_VERSION = 1;
export const DEFAULT_DEVICE_ID = 'default';

export const bleProfile = {
	serviceUuid: '0000ec00-0000-1000-8000-00805f9b34fb',
	wifiWriteCharacteristicUuid: '0000ec0e-0000-1000-8000-00805f9b34fb',
	logReadCharacteristicUuid: '0000ec0f-0000-1000-8000-00805f9b34fb'
} as const;

export const frameFormat = {
	magic: 'PF7A',
	width: 800,
	height: 480,
	paletteSize: 7
} as const;

export interface DisplayUpdateMessage {
	type: 'display';
	deviceId: string;
	requestId: string;
	createdAt: string;
	artifactKey: string;
	legacyKey?: string;
}

export interface DeviceCommandMessage {
	type: 'command';
	deviceId: string;
	refreshEvery?: number;
	reboot?: boolean;
	refreshNow?: boolean;
	syncNow?: boolean;
	clearLog?: boolean;
	deleteCurrent?: boolean;
}

export function resolveDeviceId(raw: string | undefined) {
	return raw?.trim() || DEFAULT_DEVICE_ID;
}

export function websocketPath(deviceId: string) {
	return `/ws?deviceId=${encodeURIComponent(deviceId)}`;
}
