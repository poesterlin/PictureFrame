import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { parse } from 'node:url';
import { WebSocketServer } from 'ws';

import { handler } from '../build/handler.js';
import { getDeviceBus } from '../realtime/device-bus.js';
import {
	ensureFramesDir,
	pickRandomArtifactKey,
	resolveFrameAbsolutePath
} from '../realtime/frame-storage.js';

const bus = getDeviceBus();
const port = Number(process.env.PORT || 3000);
await ensureFramesDir();

function logWs(event, details = {}) {
	const payload = {
		at: new Date().toISOString(),
		event,
		...details
	};
	console.log('[ws]', JSON.stringify(payload));
}

function resolveDeviceId(raw) {
	return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'default';
}

const server = createServer(async (req, res) => {
	const { pathname } = parse(req.url || '', true);

	if (req.method === 'GET' && pathname && pathname.startsWith('/frames/')) {
		const absolutePath = resolveFrameAbsolutePath(pathname);
		if (!absolutePath) {
			res.statusCode = 400;
			res.end('invalid frame path');
			return;
		}
		try {
			const payload = await fs.readFile(absolutePath);
			if (absolutePath.endsWith('.pf7a')) {
				res.setHeader('content-type', 'application/octet-stream');
			} else if (absolutePath.endsWith('.txt')) {
				res.setHeader('content-type', 'text/plain; charset=utf-8');
			}
			res.statusCode = 200;
			res.end(payload);
			return;
		} catch {
			res.statusCode = 404;
			res.end('frame not found');
			return;
		}
	}

	handler(req, res);
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (socket, request, deviceId) => {
	const remoteAddress = request.socket.remoteAddress;
	logWs('connected', { deviceId, remoteAddress, url: request.url });

	const unregister = bus.registerConnection(deviceId, socket);
	const snapshot = bus.getSnapshot(deviceId);
	socket.send(JSON.stringify(snapshot));
	logWs('snapshot-sent', {
		deviceId,
		hasPendingDisplay: Boolean(snapshot.pending.display),
		pendingCommandCount: snapshot.pending.commands.length
	});
	bus.ackPending(deviceId);

	if (!snapshot.pending.display) {
		pickRandomArtifactKey().then((artifactKey) => {
			if (!artifactKey) {
				logWs('random-display-skipped', { deviceId, reason: 'no-artifacts' });
				return;
			}
			logWs('random-display-publish', { deviceId, artifactKey });
			bus.publishDisplay({
				type: 'display',
				deviceId,
				requestId: crypto.randomUUID(),
				createdAt: new Date().toISOString(),
				artifactKey
			});
		});
	}

	socket.on('message', (raw) => {
		try {
			const payload = JSON.parse(raw.toString());
			logWs('message', {
				deviceId,
				type: payload?.type ?? 'unknown',
				keys: Object.keys(payload ?? {})
			});
			if (payload.type === 'state' || payload.type === 'log' || payload.type === 'ack') {
				bus.updateState(deviceId, payload);
			}
			if (payload.type === 'hello' && payload.deviceId === deviceId) {
				logWs('hello-ack-sent', { deviceId });
				socket.send(JSON.stringify(bus.getSnapshot(deviceId)));
			}
		} catch {
			logWs('message-parse-error', { deviceId, raw: raw.toString().slice(0, 180) });
		}
	});

	socket.on('error', (error) => {
		logWs('socket-error', { deviceId, message: error?.message ?? 'unknown' });
	});

	socket.on('close', (code, reasonBuffer) => {
		unregister();
		logWs('disconnected', {
			deviceId,
			code,
			reason: reasonBuffer?.toString() || ''
		});
	});
});

server.on('upgrade', (request, socket, head) => {
	const { pathname, query } = parse(request.url || '', true);
	if (pathname !== '/ws') {
		socket.destroy();
		return;
	}

	const deviceId = typeof query.deviceId === 'string' && query.deviceId.trim().length > 0
		? resolveDeviceId(query.deviceId)
		: 'default';

	wss.handleUpgrade(request, socket, head, (ws) => {
		wss.emit('connection', ws, request, deviceId);
	});
});

server.listen(port, () => {
	console.log(`PictureFrame server listening on ${port}`);
});
