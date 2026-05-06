import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { parse } from 'node:url';
import { WebSocketServer } from 'ws';

import { handler } from '../build/handler.js';
import { getDeviceBus } from '../realtime/device-bus.js';
import {
	ensureFramesDir,
	ensureFrameArtifactFile,
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
			const payload = await ensureFrameArtifactFile(absolutePath);
			if (!payload) {
				res.statusCode = 400;
				res.end('invalid frame artifact');
				return;
			}
			res.setHeader('content-type', 'application/octet-stream');
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

wss.on('connection', (socket, request) => {
	const remoteAddress = request.socket.remoteAddress;
	logWs('connected', { remoteAddress, url: request.url });

	const unregister = bus.registerConnection(socket);
	const snapshot = bus.getSnapshot();
	socket.send(JSON.stringify(snapshot));
	logWs('snapshot-sent', {
		hasPendingDisplay: Boolean(snapshot.pending.display),
		pendingCommandCount: snapshot.pending.commands.length
	});
	bus.ackPending();

	if (!snapshot.pending.display) {
		pickRandomArtifactKey().then((artifactKey) => {
			if (!artifactKey) {
				logWs('random-display-skipped', { reason: 'no-artifacts' });
				return;
			}
			logWs('random-display-publish', { artifactKey });
			bus.publishDisplay({
				type: 'display',
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
				type: payload?.type ?? 'unknown',
				keys: Object.keys(payload ?? {})
			});
			if (payload.type === 'state' || payload.type === 'log' || payload.type === 'ack') {
				bus.updateState(payload);
			}
			if (payload.type === 'hello') {
				logWs('hello-ack-sent');
				socket.send(JSON.stringify(bus.getSnapshot()));
			}
		} catch {
			logWs('message-parse-error', { raw: raw.toString().slice(0, 180) });
		}
	});

	socket.on('error', (error) => {
		logWs('socket-error', { message: error?.message ?? 'unknown' });
	});

	socket.on('close', (code, reasonBuffer) => {
		unregister();
		logWs('disconnected', {
			code,
			reason: reasonBuffer?.toString() || ''
		});
	});
});

server.on('upgrade', (request, socket, head) => {
	const { pathname } = parse(request.url || '', true);
	if (pathname !== '/ws') {
		socket.destroy();
		return;
	}

	wss.handleUpgrade(request, socket, head, (ws) => {
		wss.emit('connection', ws, request);
	});
});

server.listen(port, () => {
	console.log(`PictureFrame server listening on ${port}`);
});
