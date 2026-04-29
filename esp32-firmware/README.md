# ESP32-S3 Firmware

This firmware replaces the Raspberry Pi `update-service` runtime.

## Scope

- Target: ESP32-S3 + 7.3" 7-color panel
- Transport: WebSocket + HTTPS frame download
- Provisioning: BLE (`ec00` service, `ec0e` write, `ec0f` log read)
- Storage: only settings in NVS (Wi-Fi, refresh interval, device ID)
- Offline behavior: no frame history, no download queue, no persistent image cache

## XIAO ESP32-S3 Build Guide

### 1) Wire the e-paper module

Suggested wiring for Seeed Studio XIAO ESP32-S3:

- `VCC` -> `3V3` (or module-required supply voltage)
- `GND` -> `GND`
- `SCLK` -> `GPIO12`
- `DIN` -> `GPIO11`
- `CS` -> `GPIO10`
- `DC` -> `GPIO9`
- `RST` -> `GPIO8`
- `BUSY` -> `GPIO7`

### 2) Build and flash

```bash
# one-time per shell
. ~/esp/esp-idf/export.sh

cd esp32-firmware
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
idf.py -p /dev/ttyACM0 flash
```

Set these values in `menuconfig`:

- `PictureFrame settings -> WebSocket base URL`
- `PictureFrame settings -> Frame asset base URL`

### 3) Optional: watch boot logs

```bash
. ~/esp/esp-idf/export.sh
cd esp32-firmware
idf.py -p /dev/ttyACM0 monitor
```

If your board enumerates as `/dev/ttyUSB0` instead, replace the port accordingly.

## Protocol

- WebSocket endpoint: `wss://<host>/ws?deviceId=<deviceId>`
- Server sends `display` and `command` messages
- Device sends `state`, `log`, and `ack` messages

Display update payload:

```json
{
  "type": "display",
  "deviceId": "default",
  "requestId": "abc123",
  "createdAt": "2026-04-29T09:00:00.000Z",
  "artifactKey": "submitions/user/abc123.pf7a",
  "legacyKey": "submitions/user/abc123.txt"
}
```

The `artifactKey` resolves to a `.pf7a` binary:

- bytes `0..3`: magic `PF7A`
- bytes `4..5`: width (LE)
- bytes `6..7`: height (LE)
- bytes `8..end`: one palette index (0-6) per pixel

## Pilot Validation Checklist

- Device boots and advertises BLE service
- Wi-Fi provisioning from `/connect` succeeds
- WebSocket receives `display` and `command` payloads
- Device fetches `.pf7a` from object storage and renders panel
- Network loss keeps current frame without queueing retries
