# Image Display

This project includes a self-hosted SvelteKit Node server and an ESP32-S3 firmware target for driving a 7-color e-ink picture frame.

The web app processes uploads to an 800x480 indexed palette, stores artifacts on local disk, and pushes update/command events to devices over WebSocket. The ESP32 firmware maintains a persistent WebSocket connection, downloads the latest frame artifact from the Node server, and renders it without maintaining offline frame history.

## Frontend

To run the frontend you need to have nodejs installed.

Configure the environment variables in the `.env` file then run the following commands.

```bash
npm install
npm run dev
```

Build and run self-hosted Node server:

```bash
npm run build
npm run start
```

Environment variables:

- `DEVICE_ID` (optional, defaults to `default`)
- `PORT` (optional, default `3000` for self-hosted server)
- `FRAMES_DIR` (optional, default `<repo>/data/frames`)

## ESP32-S3 Firmware

Firmware lives in `esp32-firmware/`.

Build instructions and protocol details:

- [`esp32-firmware/README.md`](esp32-firmware/README.md)
- [`docs/esp32-pilot-cutover.md`](docs/esp32-pilot-cutover.md)

## Device Protocol (v1)

- WebSocket endpoint: `/ws?deviceId=<deviceId>`
- Server sends `display` and `command` messages
- Device sends `state`, `log`, and `ack` messages
- Frame artifacts are served from `GET /frames/<owner>/<id>.pf7a`

BLE provisioning profile (for `/connect` page):

- Service UUID: `0000ec00-0000-1000-8000-00805f9b34fb`
- Wi-Fi write characteristic: `0000ec0e-0000-1000-8000-00805f9b34fb`
- Log read characteristic: `0000ec0f-0000-1000-8000-00805f9b34fb`

## No Offline Support

- No persistent frame cache
- No queued downloads for later replay
- On network failure the current frame remains until the next successful update

## Legacy Raspberry Pi Runtime

The previous Pi implementation is kept in `update-service/` for temporary rollback/testing only and is no longer the primary path.
