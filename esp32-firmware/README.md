# ESP32-S3 Firmware

This firmware replaces the Raspberry Pi `update-service` runtime.

## Scope

- Target: ESP32-S3 + 7.3" 7-color panel
- Transport: WebSocket + HTTPS frame download
- Provisioning: BLE (`ec00` service, `ec0e` write, `ec0f` log read)
- Storage: only settings in NVS (Wi-Fi, refresh interval, device ID)
- Offline behavior: no frame history, no download queue, no persistent image cache

## XIAO ESP32-S3 / ESP32-C6 Build Guide

### 1) Wire the e-paper module

Current wiring for the XIAO ESP32-C6 e-paper breakout (silkscreen label -> ESP32 GPIO):

- `VCC` -> `3V3` (or module-required supply voltage)
- `GND` -> `GND`
- `SCLK` -> `D8`  (GPIO19)
- `DIN`  -> `D10` (GPIO18)
- `CS`   -> `D1`  (GPIO1)
- `DC`   -> `D3`  (GPIO21)
- `RST`  -> `D0`  (GPIO0)
- `BUSY` -> `D5`  (GPIO23)

Use the display/HAT in **4-line SPI** mode. The legacy Raspberry Pi driver uses separate SPI data plus `CS`, `DC`, `RST`, and `BUSY` control lines; 3-line SPI is not compatible with this firmware wiring.

Important: on XIAO-style boards, printed pin names like `D7`, `D8`, etc. are not always the same thing as ESP-IDF `GPIO_NUM_7`, `GPIO_NUM_8`, etc. Wire to the actual ESP32-S3 GPIO numbers used in `main/display_driver.c`, or update those constants to match the physical pins you used.

The firmware renders a checkerboard during startup before Wi-Fi provisioning. If the serial monitor logs `display initialized for Waveshare 7.3in 7-color` and `rendered offline checkerboard` but the panel does not change, suspect power, SPI/control wiring, or pin-number mismatch before network/protocol issues.

### 2) Build and flash

```bash
# one-time per shell
. ~/esp/esp-idf/export.sh

cd esp32-firmware
idf.py set-target esp32s3
# or, for the current ESP32-C6 board:
idf.py set-target esp32c6
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
