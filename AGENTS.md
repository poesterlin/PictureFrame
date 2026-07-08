# AGENTS.md

## Package manager & runtime

- **Bun only.** `bun install`, `bun run dev`, `bun run build`, `bun run start`.
- Lockfile is `bun.lock`. No npm/pnpm/yarn.

## Commands

```bash
bun run dev          # SvelteKit dev server
bun run build        # production build (output to /build)
bun run start        # Bun production server (server/index.ts)
bun run check        # svelte-check typechecking
bun run lint         # prettier --check + eslint
bun run format       # prettier --write
bun run db:generate  # drizzle-kit generate (schema -> SQL)
bun run db:migrate   # drizzle-kit migrate
```

## Architecture

- **SvelteKit 5** with `@sveltejs/adapter-node`. Output in `/build`.
- **Production server** is a custom Bun HTTP/WS server in `server/index.ts` — it wraps the SvelteKit SSR handler, serves static assets from `build/client` and `static/`, handles `/ws` WebSocket upgrades, and serves authenticated `/frames/*` artifact downloads.
- **WebSockets** at `/ws` are push-only from server to device. Commands from devices moved to HTTP endpoints.
- **Database** is PostgreSQL (Drizzle ORM). Connection is optional — the server degrades gracefully without `DATABASE_URL`.
- **Frame artifacts** are `.pf7a` files (8-byte header: `PF7A` magic + 800-width-le + 480-height-le, then 384k indexed pixel bytes). Stored on disk at `FRAMES_DIR` (default `./data/frames`).
- **Realtime module** (`realtime/`) is shared by the Bun server, not bundled by SvelteKit.

## Environment

Copy `.env.example` to `.env`. Required vars:

- `DATABASE_URL` — PostgreSQL connection (can be omitted for basic serving)
- `FRAMES_DIR` — local frame artifact storage path
- `ADMIN_USER_IDS` — comma-separated user IDs with admin privileges

## Style

- **Tabs** for indentation, **single quotes**, **no trailing commas**, 100 print width.
- Svelte 5 runes syntax (`$state`, `$derived`, `$effect`, etc.).
- If you need to modify the DB schema, edit `src/lib/server/db/schema.ts` then run `bun run db:generate` and `bun run db:migrate`.

## Docker

- `docker compose up -d --build` builds and runs. Traefik integration; expects an external `traefik_web` network.
- `deploy.sh` automates git fetch + docker compose rebuild.

## ESP32 firmware

- Separate subproject in `esp32-firmware/`. Build with ESP-IDF (`idf.py`), targets `esp32s3` or `esp32c6`.
- Not part of the web build pipeline.

## Vite config

- `@node-rs/argon2` is in `ssr.external` — native binary, must not be bundled.
