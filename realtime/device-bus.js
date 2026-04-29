// @ts-nocheck

const BUS_KEY = '__pictureframe_device_bus__';

function createDeviceBus() {
	const state = new Map();

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
			return () => {
				device.connections.delete(connection);
			};
		},
		publishDisplay(message) {
			const device = getOrCreate(message.deviceId);
			device.latestDisplay = message;
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
