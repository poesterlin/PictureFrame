# WebSocket / Device Channel Redesign Plan

## Goal

Replace the current ad-hoc, untyped, unauthenticated WebSocket server with:

- A typed, polling-based HTTP API as the primary device protocol.
- A thin WebSocket adapter that only pushes server-to-client events.
- Bearer-authentication using the existing `pictureFrames.authKey`.
- Multi-frame isolation everywhere (state, events, artifacts).

## Decisions (locked)

- **Frame auth**: `Authorization: Bearer <authKey>` resolved against `pictureFrames.authKey` (already unique). No new sessions table.
- **Random display selection**: server picks on `hello` if no pending display, and on explicit user "refresh" command. Frame keeps its own scheduler for ongoing rotation. No global tick loop on the server.
- **Random weighting**: favor `favorite=true`, exclude `skipped=true`, scoped by `frameId`.
- **WS path**: keep `/ws`.
- **Runtime**: Bun (`Bun.serve`) for the bootstrap and WS; SvelteKit `handler` invoked from Bun's `fetch`.
- **Pictures get `frameId`**: new NOT NULL column referencing `picture_frames(id)` ON DELETE CASCADE. Existing `pictures` rows wiped before migration.
- **Artifact endpoint authenticated**: `/frames/*` requires Bearer authKey AND DB ownership (`pictures.fileName == artifactKey AND pictures.frameId == frame.id`).

## Module layout

### New TypeScript modules under `src/lib/server/device/`

- `auth.ts`
  - `authenticateFrameRequest(headers)` → `{ frameId, ownerUserId } | null`.
  - Helpers for SvelteKit endpoints and Bun WS upgrade.
  - 401 on missing/invalid token; WS close code `4401`.

- `channel.ts`
  - Per-frame state in `Map<frameId, FrameChannelState>`.
  - State: `{ cursor, latestDisplay, pendingCommands[], lastState, subscribers:Set<(ev)=>void> }`.
  - API:
    - `publishDisplay(frameId, msg)`
    - `publishCommand(frameId, msg)`
    - `getSnapshot(frameId)` → `{ display, commands, cursor }`
    - `getEventsSince(frameId, cursor, waitMs)` (long-poll)
    - `ack(frameId, cursor)`
    - `recordState(frameId, state)`
    - `subscribe(frameId, handler)` (used only by WS adapter)
  - Monotonic per-frame cursor.
  - Replaces `realtime/device-bus.js`.

- `picker.ts`
  - Weighted random selection over `pictures` for a given `frameId`.
  - Excludes `skipped=true`. Favorites weighted higher.
  - Returns `{ pictureId, artifactKey }` or `null`.
  - Pure function over the DB.

### Polling endpoints under `src/routes/api/frame/`

All Bearer-authed via `auth.ts`.

- `POST /api/frame/hello`
  - Records protocol handshake.
  - If no `latestDisplay` is pending, calls `picker` and `channel.publishDisplay`.
  - Returns snapshot.
- `GET  /api/frame/snapshot` — display + commands + cursor.
- `GET  /api/frame/events?after=<cursor>&wait=<ms>` — long-poll.
- `POST /api/frame/ack` — body `{ cursor }`.
- `POST /api/frame/state` — frame state heartbeat.

### Bun bootstrap (`server/index.ts`)

Replaces `server/index.js`. Uses `Bun.serve({ fetch, websocket })`.

- `fetch(req)`:
  - `GET /frames/*`: Bearer auth + DB ownership check; serve artifact bytes.
  - Else: delegate to SvelteKit `handler` from `build/handler.js`.
- `websocket`:
  - Upgrade at `/ws`.
  - Bearer auth at upgrade (header preferred; `?token=<authKey>` fallback).
  - On open: `channel.subscribe(frameId, ev => ws.send(JSON.stringify(ev)))`.
  - Inbound messages ignored (or pong only). All client→server traffic moves to HTTP polling.

### Route migrations (publishers)

Switch from `realtime/device-bus.js` to `channel`:

- `src/routes/upload/+page.server.ts` — also writes `pictures.frameId`.
- `src/routes/command/+server.ts`.
- `src/routes/settings/+page.server.ts`.
- `src/routes/preview/action/+server.ts`.
- `src/routes/device/state/+server.ts`.

Each resolves `frameId` from request context (already known via owner/link/frame lookups).

### Schema change

`pictures` gets:

```
frameId integer NOT NULL REFERENCES picture_frames(id) ON DELETE CASCADE
```

Existing `pictures` rows are wiped before the migration. Drizzle migration generated via `npm run db:generate` and applied via `npm run db:migrate`.

### Cleanup

- Delete `realtime/device-bus.js`.
- Keep `realtime/frame-storage.js` (still used for artifact IO).
- `package.json#scripts.start` → `bun run server/index.ts`.

## Migration order

1. Schema: wipe `pictures`, add `frameId NOT NULL`, generate + apply migration.
2. Update upload/preview paths to write/read `pictures.frameId`.
3. Add `auth.ts`, `channel.ts`, `picker.ts`.
4. Add polling endpoints under `src/routes/api/frame/*`.
5. Convert `server/index.js` → `server/index.ts` on Bun; mount Bearer-auth'd `/frames/*` and push-only `/ws`.
6. Switch publisher routes to `channel`.
7. Remove `realtime/device-bus.js`.
8. Firmware update (separate task):
   - Send `Authorization: Bearer <authKey>` on WS upgrade and artifact GET.
   - Move `hello`/`state`/`ack` from WS to HTTP polling endpoints.
   - Keep WS for push receive only.

## Validation checklist

- Multi-frame isolation: frame A cannot read frame B events, snapshot, or artifacts.
- Auth:
  - Missing/invalid Bearer → 401 on HTTP, WS close `4401`.
  - Rotating `pictureFrames.authKey` revokes access immediately.
- Delivery:
  - Upload triggers display event visible via both polling (`/events`) and WS push.
  - Reconnect with `?after=<cursor>` returns missed events.
- Idempotency:
  - Duplicate `ack` cursor is a no-op.
  - Duplicate `requestId` for display handled by frame (existing behavior).
- Selection:
  - `picker` honors `favorite` weighting and excludes `skipped`.
  - Scoped strictly by `frameId`.
- Artifact:
  - 401 without Bearer.
  - 403/404 if `artifactKey` not owned by auth'd frame.
  - 200 with bytes when owned.

## Out of scope (follow-ups)

- Persisting `latestDisplay`/`cursor` across server restarts (currently in-memory; acceptable per user's "won't restart often").
- Frame session rotation / revocation table.
- Migrating `realtime/frame-storage.js` to TS.
