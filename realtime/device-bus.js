// @ts-nocheck

const BUS_KEY = '__pictureframe_device_bus__';

function createDeviceBus() {
	const state = new Map();
	const log = (event, details = {}) => {
		console.log('[device-bus]', JSON.stringify({
			at: new Date().toISOString(),
			event,
			...details
		}));
	};

	function getOrCreate(deviceId) {
		if (!state.has(deviceId)) {
			state.set(deviceId, {
				connections: new Set(),
				latestDisplay: null,
				pendingCommands: [],
				lastState: null
			});
		}
		return state.get(deviceId);
	}

	function toJson(payload) {
		return JSON.stringify(payload);
	}

	return {
		registerConnection(deviceId, connection) {
			const device = getOrCreate(deviceId);
			device.connections.add(connection);
			log('connection-register', {
				deviceId,
				connectionCount: device.connections.size
			});
			return () => {
				device.connections.delete(connection);
				log('connection-unregister', {
					deviceId,
					connectionCount: device.connections.size
				});
			};
		},
		publishDisplay(message) {
			const device = getOrCreate(message.deviceId);
			device.latestDisplay = message;
			log('display-publish', {
				deviceId: message.deviceId,
				artifactKey: message.artifactKey,
				connectionCount: device.connections.size
			});
			const wire = toJson(message);
			for (const connection of device.connections) {
				connection.send(wire);
			}
		},
		publishCommand(message) {
			const device = getOrCreate(message.deviceId);
			device.pendingCommands.push(message);
			if (device.pendingCommands.length > 50) {
				device.pendingCommands.shift();
			}
			log('command-publish', {
				deviceId: message.deviceId,
				connectionCount: device.connections.size
			});
			const wire = toJson(message);
			for (const connection of device.connections) {
				connection.send(wire);
			}
		},
		getSnapshot(deviceId) {
			const device = getOrCreate(deviceId);
			return {
				type: 'helloAck',
				deviceId,
				serverTime: new Date().toISOString(),
				pending: {
					display: device.latestDisplay,
					commands: device.pendingCommands
				}
			};
		},
		ackPending(deviceId) {
			const device = getOrCreate(deviceId);
			device.pendingCommands = [];
		},
		updateState(deviceId, payload) {
			const device = getOrCreate(deviceId);
			device.lastState = payload;
			log('state-update', {
				deviceId,
				type: payload?.type ?? 'unknown',
				status: payload?.status ?? null
			});
		},
		getLastState(deviceId) {
			return getOrCreate(deviceId).lastState;
		}
	};
}

export function getDeviceBus() {
	if (!globalThis[BUS_KEY]) {
		globalThis[BUS_KEY] = createDeviceBus();
	}
	return globalThis[BUS_KEY];
}
