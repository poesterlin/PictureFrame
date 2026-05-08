import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveFrameAbsolutePath } from '../realtime/frame-storage.js';
import {
	authenticateFrameWsRequest,
	authenticateFrameRequest,
	unauthorizedHttpResponse
} from '../src/lib/server/device/auth';
import { getDeviceChannel, type FrameChannelEvent } from '../src/lib/server/device/channel';
import postgres from 'postgres';
import { Server } from '../build/server/index.js';
import { manifest } from '../build/server/manifest.js';

const port = Number(process.env.PORT || 3000);
const channel = getDeviceChannel();
const staticRoots = [resolve(import.meta.dir, '../build/client'), resolve(import.meta.dir, '../static')];
let _sql: ReturnType<typeof postgres> | null = null;

async function serveStaticAsset(pathname: string): Promise<Response | null> {
	if (pathname.includes('\0')) {
		return null;
	}

	let decodedPath = pathname;
	try {
		decodedPath = decodeURIComponent(pathname);
	} catch {
		decodedPath = pathname;
	}

	for (const root of staticRoots) {
		const absolutePath = resolve(root, `.${decodedPath}`);
		if (absolutePath !== root && !absolutePath.startsWith(`${root}/`)) {
			continue;
		}

		const asset = Bun.file(absolutePath);
		if (await asset.exists()) {
			return new Response(asset, { status: 200 });
		}
	}

	return null;
}

function getSql() {
	if (!_sql) {
		if (!process.env.DATABASE_URL) {
			return null;
		}
		_sql = postgres(process.env.DATABASE_URL, {
			max: 5,
			idle_timeout: 5
		});
	}
	return _sql;
}

const ssr = new Server(manifest);
await ssr.init({ env: process.env as Record<string, string> });

async function resolveFrameArtifactOwner(frameId: number, artifactKey: string): Promise<boolean> {
	const sql = getSql();
	if (!sql) {
		return false;
	}

	const rows = await sql<{ id: number }[]>`
		select id
		from pictures
		where file_name = ${artifactKey}
		and frame_id = ${frameId}
		limit 1
	`;

	return rows.length > 0;
}

function firstForwardedValue(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const first = value.split(',')[0]?.trim();
	return first && first.length > 0 ? first : null;
}

function normalizeRequestForProxy(req: Request, url: URL): Request {
	const forwardedHost = firstForwardedValue(req.headers.get('x-forwarded-host'));
	const forwardedProto = firstForwardedValue(req.headers.get('x-forwarded-proto'));

	if (!forwardedHost && !forwardedProto) {
		return req;
	}

	const protocol = forwardedProto ?? url.protocol.replace(':', '');
	const host = forwardedHost ?? req.headers.get('host') ?? url.host;
	const normalizedUrl = `${protocol}://${host}${url.pathname}${url.search}`;

	return new Request(normalizedUrl, {
		method: req.method,
		headers: req.headers,
		body: req.body,
		duplex: 'half'
	});
}

Bun.serve({
	port,
	async fetch(req, server) {
		const url = new URL(req.url);

		if (url.pathname === '/ws') {
			const frame = await authenticateFrameWsRequest(req);
			if (!frame) {
				return unauthorizedHttpResponse();
			}

			const upgraded = server.upgrade(req, {
				data: {
					frameId: frame.frameId
				}
			});

			if (!upgraded) {
				return new Response('Upgrade failed', { status: 400 });
			}

			return undefined;
		}

		if (req.method === 'GET') {
			const staticResponse = await serveStaticAsset(url.pathname);
			if (staticResponse) {
				return staticResponse;
			}
		}

		if (req.method === 'GET' && url.pathname.startsWith('/frames/')) {
			const frame = await authenticateFrameRequest(req.headers);
			if (!frame) {
				return unauthorizedHttpResponse();
			}

			const absolutePath = resolveFrameAbsolutePath(url.pathname);
			if (!absolutePath) {
				return new Response('Invalid frame path', { status: 400 });
			}

			const artifactKey = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
			const owned = await resolveFrameArtifactOwner(frame.frameId, artifactKey);
			if (!owned) {
				return new Response('Artifact not found', { status: 404 });
			}

			try {
				const payload = await readFile(absolutePath);
				return new Response(payload, {
					status: 200,
					headers: {
						'content-type': 'application/octet-stream'
					}
				});
			} catch {
				return new Response('Frame not found', { status: 404 });
			}
		}

		const normalizedRequest = normalizeRequestForProxy(req, url);
		const response = await ssr.respond(normalizedRequest, {
			getClientAddress: () => req.headers.get('x-forwarded-for') ?? '127.0.0.1'
		});
		return response;
	},
	websocket: {
		open(ws) {
			const frameId = (ws.data as { frameId?: number } | undefined)?.frameId;
			if (!frameId) {
				ws.close(4401, 'Unauthorized');
				return;
			}

			const unsubscribe = channel.subscribe(frameId, (ev: FrameChannelEvent) => {
				ws.send(JSON.stringify(ev));
			});
			(ws.data as { unsubscribe?: () => void }).unsubscribe = unsubscribe;
		},
		message() {
			// Push-only socket: client->server commands moved to HTTP endpoints.
		},
		close(ws) {
			const unsubscribe = (ws.data as { unsubscribe?: () => void } | undefined)?.unsubscribe;
			if (unsubscribe) {
				unsubscribe();
			}
		},
		error(ws) {
			const unsubscribe = (ws.data as { unsubscribe?: () => void } | undefined)?.unsubscribe;
			if (unsubscribe) {
				unsubscribe();
			}
		}
	}
});

console.log(`PictureFrame Bun server listening on ${port}`);
