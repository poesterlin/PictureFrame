// @ts-nocheck

const BUS_KEY = '__pictureframe_device_bus__';

function createDeviceBus() {
	const state = {
		connections: new Set(),
		latestDisplay: null,
		pendingCommands: [],
		lastState: null
	};
	const log = (event, details = {}) => {
		console.log('[device-bus]', JSON.stringify({
			at: new Date().toISOString(),
			event,
			...details
		}));
	};

	function toJson(payload) {
		return JSON.stringify(payload);
	}

	return {
		registerConnection(connection) {
			state.connections.add(connection);
			log('connection-register', {
				connectionCount: state.connections.size
			});
			return () => {
				state.connections.delete(connection);
				log('connection-unregister', {
					connectionCount: state.connections.size
				});
			};
		},
		publishDisplay(message) {
			state.latestDisplay = message;
			log('display-publish', {
				artifactKey: message.artifactKey,
				connectionCount: state.connections.size
			});
			const wire = toJson(message);
			for (const connection of state.connections) {
				connection.send(wire);
			}
		},
		publishCommand(message) {
			state.pendingCommands.push(message);
			if (state.pendingCommands.length > 50) {
				state.pendingCommands.shift();
			}
			log('command-publish', {
				connectionCount: state.connections.size
			});
			const wire = toJson(message);
			for (const connection of state.connections) {
				connection.send(wire);
			}
		},
		getSnapshot() {
			return {
				type: 'helloAck',
				serverTime: new Date().toISOString(),
				pending: {
					display: state.latestDisplay,
					commands: state.pendingCommands
				}
			};
		},
		ackPending() {
			state.pendingCommands = [];
		},
		updateState(payload) {
			state.lastState = payload;
			log('state-update', {
				type: payload?.type ?? 'unknown',
				status: payload?.status ?? null
			});
		},
		getLastState() {
			return state.lastState;
		}
	};
}

export function getDeviceBus() {
	if (!globalThis[BUS_KEY]) {
		globalThis[BUS_KEY] = createDeviceBus();
	}
	return globalThis[BUS_KEY];
}
