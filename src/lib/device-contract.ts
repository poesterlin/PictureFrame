export const DEVICE_PROTOCOL_VERSION = 2;

export const bleProfile = {
	serviceUuid: '0000ec00-0000-1000-8000-00805f9b34fb',
	wifiWriteCharacteristicUuid: '0000ec0e-0000-1000-8000-00805f9b34fb'
} as const;

export const frameFormat = {
	magic: 'PF7A',
	width: 800,
	height: 480,
	paletteSize: 7
} as const;

export interface HelloMessage {
	type: 'hello';
	fwVersion?: string;
}

export interface DisplayUpdateMessage {
	type: 'display';
	requestId: string;
	createdAt: string;
	artifactKey: string;
	legacyKey?: string;
}

export interface DeviceCommandMessage {
	type: 'command';
	refreshEvery?: number;
	reboot?: boolean;
	refreshNow?: boolean;
	syncNow?: boolean;
	deleteCurrent?: boolean;
}

export function websocketPath() {
	return '/ws';
}
