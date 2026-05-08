import { db } from '../db';
import { pictureFrames } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { DeviceCommandMessage, DisplayUpdateMessage } from '../../device-contract';

const CHANNEL_KEY = '__pictureframe_device_channel__';
const MAX_HISTORY = 500;
const MAX_PENDING_COMMANDS = 50;

export type FrameChannelEvent = {
	cursor: number;
	message: DisplayUpdateMessage | DeviceCommandMessage;
};

type Waiter = () => void;

function isCommandMessage(message: DisplayUpdateMessage | DeviceCommandMessage): message is DeviceCommandMessage {
	return message.type === 'command';
}

type FrameChannelState = {
	cursor: number;
	latestDisplay: DisplayUpdateMessage | null;
	pendingCommands: FrameChannelEvent[];
	lastState: unknown;
	history: FrameChannelEvent[];
	subscribers: Set<(ev: FrameChannelEvent) => void>;
	waiters: Set<Waiter>;
};

type FrameSnapshot = {
	display: DisplayUpdateMessage | null;
	commands: DeviceCommandMessage[];
	cursor: number;
};

function createState(): FrameChannelState {
	return {
		cursor: 0,
		latestDisplay: null,
		pendingCommands: [],
		lastState: null,
		history: [],
		subscribers: new Set(),
		waiters: new Set()
	};
}

function createChannel() {
	const states = new Map<number, FrameChannelState>();

	function getOrCreateState(frameId: number): FrameChannelState {
		const existing = states.get(frameId);
		if (existing) {
			return existing;
		}
		const created = createState();
		states.set(frameId, created);
		return created;
	}

	function pushEvent(frameId: number, message: DisplayUpdateMessage | DeviceCommandMessage): FrameChannelEvent {
		const state = getOrCreateState(frameId);
		const ev: FrameChannelEvent = {
			cursor: state.cursor + 1,
			message
		};
		state.cursor = ev.cursor;
		state.history.push(ev);
		if (state.history.length > MAX_HISTORY) {
			state.history.splice(0, state.history.length - MAX_HISTORY);
		}
		for (const subscriber of state.subscribers) {
			subscriber(ev);
		}
		for (const waiter of state.waiters) {
			waiter();
		}
		state.waiters.clear();
		return ev;
	}

	function eventsAfter(state: FrameChannelState, cursor: number): FrameChannelEvent[] {
		return state.history.filter((entry) => entry.cursor > cursor);
	}

	return {
		publishDisplay(frameId: number, msg: DisplayUpdateMessage): FrameChannelEvent {
			const state = getOrCreateState(frameId);
			state.latestDisplay = msg;
			db.update(pictureFrames).set({ lastDisplayedAt: new Date() }).where(eq(pictureFrames.id, frameId)).catch(() => {});
			return pushEvent(frameId, msg);
		},
		publishCommand(frameId: number, msg: DeviceCommandMessage): FrameChannelEvent {
			const ev = pushEvent(frameId, msg);
			const state = getOrCreateState(frameId);
			state.pendingCommands.push(ev);
			if (state.pendingCommands.length > MAX_PENDING_COMMANDS) {
				state.pendingCommands.splice(0, state.pendingCommands.length - MAX_PENDING_COMMANDS);
			}
			return ev;
		},
		getSnapshot(frameId: number): FrameSnapshot {
			const state = getOrCreateState(frameId);
			return {
				display: state.latestDisplay,
				commands: state.pendingCommands.map((entry) => entry.message).filter(isCommandMessage),
				cursor: state.cursor
			};
		},
		async getEventsSince(frameId: number, cursor: number, waitMs: number): Promise<{ events: FrameChannelEvent[]; cursor: number }> {
			const state = getOrCreateState(frameId);
			const immediate = eventsAfter(state, cursor);
			if (immediate.length > 0 || waitMs <= 0) {
				return { events: immediate, cursor: state.cursor };
			}

			await new Promise<void>((resolve) => {
				const done = () => {
					state.waiters.delete(done);
					resolve();
				};
				state.waiters.add(done);
				setTimeout(done, waitMs);
			});

			return {
				events: eventsAfter(state, cursor),
				cursor: state.cursor
			};
		},
		ack(frameId: number, cursor: number): void {
			const state = getOrCreateState(frameId);
			state.pendingCommands = state.pendingCommands.filter((entry) => entry.cursor > cursor);
		},
		recordState(frameId: number, statePayload: unknown): void {
			const state = getOrCreateState(frameId);
			state.lastState = statePayload;
		},
		getLastState(frameId: number): unknown {
			const state = getOrCreateState(frameId);
			return state.lastState;
		},
		subscribe(frameId: number, handler: (ev: FrameChannelEvent) => void): () => void {
			const state = getOrCreateState(frameId);
			state.subscribers.add(handler);
			return () => {
				state.subscribers.delete(handler);
			};
		}
	};
}

export function getDeviceChannel() {
	const world = globalThis as typeof globalThis & { [CHANNEL_KEY]?: ReturnType<typeof createChannel> };
	if (!world[CHANNEL_KEY]) {
		world[CHANNEL_KEY] = createChannel();
	}
	return world[CHANNEL_KEY];
}
