# ESP32 Firmware

This firmware replaces the Raspberry Pi `update-service` runtime.

## Scope

- Target: ESP32-C6 or ESP32-S3 + 7.3" 7-color panel
- Transport: WebSocket + HTTPS frame download
- Provisioning: BLE (`ec00` service, `ec0e` write) or Web Serial over USB-CDC
- Storage: only settings in NVS (Wi-Fi, refresh interval, auth key)
- Offline behavior: no frame history, no download queue, no persistent image cache

## XIAO ESP32-C6 / ESP32-S3 Build Guide

Both XIAO form-factor boards (ESP32-C6 and ESP32-S3) are supported using the same
silkscreen labels (D0-D10). Wire once; the firmware selects the correct GPIO
mapping at compile time based on `CONFIG_IDF_TARGET`.

### 1) Wire the e-paper module

Use the same physical wiring for both boards (silkscreen label wiring):

- `VCC` -> `3V3` (or module-required supply voltage)
- `GND` -> `GND`
- `SCLK` -> `D8`
- `DIN` -> `D10`
- `CS` -> `D1`
- `DC` -> `D3`
- `RST` -> `D0`
- `BUSY` -> `D5`

The firmware maps these to the correct GPIO at compile time:

| Silkscreen | Signal | ESP32-C6 GPIO | ESP32-S3 GPIO |
|------------|--------|---------------|---------------|
| D0         | RST    | 0             | 1             |
| D1         | CS     | 1             | 2             |
| D3         | DC     | 21            | 4             |
| D5         | BUSY   | 23            | 6             |
| D8         | SCK    | 19            | 7             |
| D10        | MOSI   | 18            | 9             |

Use the display/HAT in **4-line SPI** mode. The legacy Raspberry Pi driver uses
separate SPI data plus `CS`, `DC`, `RST`, and `BUSY` control lines; 3-line SPI
is not compatible with this firmware wiring.

Important: on XIAO-style boards, printed pin names like `D7`, `D8`, etc. are
not always the same thing as ESP-IDF `GPIO_NUM_7`, `GPIO_NUM_8`, etc. The
firmware handles this automatically per target. If you use a different board
layout, update the pin constants in `main/display_driver.c`.

The firmware renders a checkerboard during startup before Wi-Fi provisioning.
If the serial monitor logs `display initialized for Waveshare 7.3in 7-color`
and `rendered offline checkerboard` but the panel does not change, suspect
power, SPI/control wiring, or pin-number mismatch before network/protocol
issues.

### 2) Switch target and build

Each target (ESP32-C6, ESP32-S3) has its own known-good `sdkconfig` template.
Use `switch-target.sh` to activate one before building:

```bash
# one-time per shell
. ~/esp/esp-idf/export.sh

cd esp32-firmware

# Activate your target (does a fullclean when switching architectures):
./switch-target.sh esp32c6   # or esp32s3

# Optional: review settings
idf.py menuconfig

# Build & flash
idf.py build
idf.py -p /dev/ttyACM0 flash
```

The script copies `sdkconfig.<target>` to `sdkconfig` and runs `idf.py set-target`.
If the sdkconfig drifts from the template (e.g. after `menuconfig` edits), re-running
the script restores it. To persist custom settings, edit the template file instead.

### 2b) Create merged binaries for web flashing

The web flasher at `/connect` serves firmware from `static/firmware/`. Build
both targets and merge each into a single flashable binary.

**Full publishing workflow:**

```bash
# 1) Source ESP-IDF
. ~/esp/esp-idf/export.sh
cd esp32-firmware
```

```bash
# 2) Build and merge for ESP32-C6
./switch-target.sh esp32c6
idf.py build
esptool --chip esp32c6 merge-bin \
  -o ../static/firmware/merged_c6.bin \
  --flash-mode dio --flash-size 4MB --flash-freq 80m \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0xf000 build/ota_data_initial.bin \
  0x20000 build/pictureframe.bin
```

```bash
# 3) Build and merge for ESP32-S3
./switch-target.sh esp32s3
idf.py build
esptool --chip esp32s3 merge-bin \
  -o ../static/firmware/merged_s3.bin \
  --flash-mode dio --flash-size 8MB --flash-freq 80m \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0xf000 build/ota_data_initial.bin \
  0x20000 build/pictureframe.bin
```

```bash
# 2) Build and merge for ESP32-C6
cd esp32-firmware
idf.py set-target esp32c6 && idf.py build
esptool --chip esp32c6 merge-bin \
  -o ../static/firmware/merged_c6.bin \
  --flash-mode dio --flash-size 4MB --flash-freq 80m \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0xf000 build/ota_data_initial.bin \
  0x20000 build/pictureframe.bin
```

```bash
# 3) Build and merge for ESP32-S3
idf.py set-target esp32s3 && idf.py build
esptool --chip esp32s3 merge-bin \
  -o ../static/firmware/merged_s3.bin \
  --flash-mode dio --flash-size 8MB --flash-freq 80m \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0xf000 build/ota_data_initial.bin \
  0x20000 build/pictureframe.bin
```

```bash
# 4) Bump version and verify
# Edit ../static/firmware/manifest.json — increment "version"
ls -lh ../static/firmware/
```

**Output structure (`static/firmware/`):**

```
static/firmware/
├── manifest.json      # version + chipFamily entries
├── merged_c6.bin      # ESP32-C6 combined binary
└── merged_s3.bin      # ESP32-S3 combined binary
```

The `manifest.json` lists both chips so the browser-based flasher
auto-detects and picks the correct binary:

```json
{
  "name": "PictureFrame",
  "version": "0.3.0",
  "new_install_prompt_erase": true,
  "builds": [
    { "chipFamily": "ESP32-C6", "parts": [{ "path": "/firmware/merged_c6.bin", "offset": 0 }] },
    { "chipFamily": "ESP32-S3", "parts": [{ "path": "/firmware/merged_s3.bin", "offset": 0 }] }
  ]
}
```

### sdkconfig templates

Each target has a committed `sdkconfig.<target>` with known-good settings.
The active `sdkconfig` is a copy generated by `switch-target.sh` and should
not be committed (it's in `.gitignore`).

| File | Target | Key differences |
|---|---|---|
| `sdkconfig.esp32c6` | ESP32-C6 | RISC-V, NimBLE BLE, 3584-byte main stack |
| `sdkconfig.esp32s3` | ESP32-S3 | Xtensa, USB-CDC only (no BLE), 8192-byte main stack |

When making persistent config changes, edit the template file, then re-run
`switch-target.sh` to apply them.

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

### Wi-Fi provisioning

The firmware supports two provisioning methods:

1. **BLE (legacy)** — The ESP32 advertises service `0xec00` with write characteristic `0xec0e`.
   Send a JSON payload `{"type":"wifiProvision","ssid":"...","password":"...","authKey":"..."}`
   over BLE and the device saves to NVS then reboots.

2. **Web Serial (USB)** — Available as an alternative on the `/connect` page. Plug the ESP32
   into USB, switch to the USB tab, and the browser sends the same JSON payload over the
   built-in USB-CDC serial port at 115200 baud. The device acknowledges with
   `{"type":"wifiProvision","status":"ok"}` before rebooting.

Both methods run concurrently when Wi-Fi is not configured. Either will trigger the same
save-and-reboot handler.

### Troubleshooting: `idf.py` not found

If you see an error like `idf.py: command not found`, load the ESP-IDF environment in your current shell first:

```bash
. ~/esp/esp-idf/export.sh
```

Then verify and build:

```bash
idf.py --version
idf.py build
```

## Protocol

- WebSocket endpoint: `wss://<host>/ws`
- Server sends `display` and `command` messages
- Device sends `hello`, `state`, and `ack` messages

Hello payload now includes `authKey` (when configured) so the device can participate in the authenticated websocket flow.

Display update payload:

```json
{
	"type": "display",
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
