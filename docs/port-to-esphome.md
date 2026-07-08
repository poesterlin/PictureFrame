# Porting PictureFrame to ESPHome

Reference notes for rebuilding the same hardware/firmware (XIAO ESP32-C6 +
Waveshare 7.3" 7-color panel) on top of ESPHome instead of the current
ESP-IDF codebase in `esp32-firmware/`.

All values below were extracted from `esp32-firmware/main/display_driver.c`
and the surrounding modules.

## Hardware

### Board

- XIAO ESP32-C6 (also builds for XIAO ESP32-S3 via `idf.py set-target`)
- Waveshare 7.3" 7-color e-paper panel, 800×480

### Pin assignments (XIAO ESP32-C6 e-paper wiring)

Silkscreen label → actual ESP32 GPIO → function:

| Silkscreen | ESP32 GPIO | Function                                |
| ---------- | ---------- | --------------------------------------- |
| `D0`       | GPIO0      | RST (output)                            |
| `D1`       | GPIO1      | CS (output, software-controlled)        |
| `D3`       | GPIO21     | DC (data/command select, output)        |
| `D5`       | GPIO23     | BUSY (input, internal pull-up required) |
| `D8`       | GPIO19     | SCLK (SPI clock)                        |
| `D10`      | GPIO18     | MOSI (SPI DIN)                          |

Power:

- `VCC` → `3V3` (or the module-required supply)
- `GND` → `GND`

The wiring must use **4-line SPI**: separate MOSI plus `CS`, `DC`, `RST`,
and `BUSY` control lines. 3-line SPI is not compatible with this firmware.

> On XIAO-style boards, printed pin names like `D7`, `D8` are not always the
> same as ESP-IDF `GPIO_NUM_7` / `GPIO_NUM_8`. Wire to the actual ESP32-S3/C6
> GPIO numbers listed above, or change them in `display_driver.c` to match
> your physical wiring.

## Display driver quirks

### Panel

- Resolution: **800×480**
- Color depth: **7 colors**, palette indices 0–6, **2 pixels per byte**
  (high nibble = left pixel, low nibble = right pixel)
- Buffer size: `800/2 * 480 = 192,000` bytes, must be DMA-capable
  (`MALLOC_CAP_DMA | MALLOC_CAP_8BIT` in the current driver)

### 7-color palette

| Index | Color  | ESPHome `Color` enum |
| ----: | ------ | -------------------- |
|     0 | Black  | `Color::BLACK`       |
|     1 | White  | `Color::WHITE`       |
|     2 | Green  | `Color::GREEN`       |
|     3 | Blue   | `Color::BLUE`        |
|     4 | Red    | `Color::RED`         |
|     5 | Yellow | `Color::YELLOW`      |
|     6 | Orange | `Color::ORANGE`      |

ESPHome's `WaveshareEpd7in3f` color enum matches this mapping, so palette
indices pass through directly. Values `>= 7` are clamped to 1 (white) for
legacy compatibility with the old `GUI_ReadBmp_RGB_7Color` path.

### SPI bus

- Host: `SPI2_HOST`
- Mode: 0 (CPOL=0, CPHA=0), MSB-first
- Clock: 2 MHz (conservative for software-CS over jumper wires; raise once
  pixels render correctly)
- No MISO
- `spics_io_num = -1` — CS is software-controlled, toggled around each
  command/data phase. ESPHome's CS pin must be set, and the display
  component must drive CS manually.
- `max_transfer_sz = 4096`, DMA channel `SPI_DMA_CH_AUTO`

### BUSY pin behavior

- Idle level is **high** (`s_busy_idle_level = 1`)
- Open-drain on some Waveshare-compatible boards → internal **pull-up
  required**
- Default wait timeout: 30 s
- 500 µs probe on every wait; if BUSY never asserts, the driver
  automatically falls back to timed delays:
  - short waits: 200 ms
  - power on/off: 250 ms
  - full display refresh: 18 s
- Diagnostic busy-pin samples are logged at 0 / 1k / 5k / 20k / 100k /
  500k / 2M / 5M µs after each command — useful to distinguish a dead/
  floating line from a slow-asserting one without a scope

If the panel does not change but logs show `display initialized for
Waveshare 7.3in 7-color` and `rendered offline checkerboard`, suspect
power, SPI/control wiring, or pin-number mismatch **before** network /
protocol issues.

### DC pin

- `DC = 0` → command byte
- `DC = 1` → data byte(s)
- CS must be asserted low before each transfer and deasserted high
  afterwards (software CS)

### Reset pulse

```
RST high  → wait 20 ms
RST low   → wait 10 ms
RST high  → wait 20 ms
```

After reset, the driver waits for the BUSY pin to reach idle, then
sleeps an additional 30 ms before starting the init sequence.

### Init sequence (vendor-specific, sent once per refresh)

| Cmd  | Data bytes                  |
| ---- | --------------------------- |
| 0xAA | `49 55 20 08 09 18`         |
| 0x01 | `3F 00 32 2A 0E 2A`         |
| 0x00 | `5F 69`                     |
| 0x03 | `00 54 00 44`               |
| 0x05 | `40 1F 1F 2C`               |
| 0x06 | `6F 1F 16 25`               |
| 0x08 | `6F 1F 1F 22`               |
| 0x13 | `00 04`                     |
| 0x30 | `02`                        |
| 0x41 | `00`                        |
| 0x50 | `3F`                        |
| 0x60 | `02 00`                     |
| 0x61 | `03 20 01 E0` (res 800×480) |
| 0x82 | `1E`                        |
| 0x84 | `00`                        |
| 0x86 | `00`                        |
| 0xE3 | `2F`                        |
| 0xE0 | `00`                        |
| 0xE6 | `00`                        |

If the first init attempt fails, the driver retries once with the timed
BUSY fallback enabled.

### Per-frame protocol

This differs from the standard Waveshare 7.3" driver — ESPHome's bundled
component does not implement this exact sequence, so the opcodes and
flow below need to be reproduced verbatim in any custom display
component.

1. Send command `0x10` (start frame data write)
2. Stream **all 192,000 bytes** of 2pp packed pixel data (one packed
   byte per pair of adjacent pixels, high nibble = left)
3. Send command `0x04` (POWER_ON), wait BUSY (~250 ms)
4. Send command `0x12 0x00` (DISPLAY_REFRESH), wait BUSY (~18 s, full
   refresh)
5. Send command `0x02 0x00` (POWER_OFF), wait BUSY (~250 ms)

SPI transfers are chunked at 512 bytes per `spi_device_polling_transmit`
call, with a 1-tick yield every 8 rows.

### Pixel packing

Input image: 1 palette index per pixel (800×480 = 384,000 indices).
Driver packs two adjacent pixels into one byte:

```c
packed[px / 2] = (left << 4) | right;
```

Color values `>= 7` are clamped to `1` (white) for legacy compatibility.

## Frame format (PF7A)

Used by the server to ship rendered frames to the device.

```
+--------+--------+--------+--------+--- ... ---+
|  'P'   |  'F'   |  '7'   |  'A'   |   payload |
+--------+--------+--------+--------+--- ... ---+
  byte 0    byte 1    byte 2    byte 3    byte 8+
```

- Bytes `0..3`: magic `PF7A`
- Bytes `4..5`: width, little-endian u16 (must be `800`)
- Bytes `6..7`: height, little-endian u16 (must be `480`)
- Bytes `8..end`: one palette index (0–6) per pixel

Total payload size = `8 + 800*480 = 384,008` bytes.

The driver supports two ingestion modes:

- **Buffered**: download whole payload to RAM, then call
  `display_driver_render_pf7a()`.
- **Streaming**: stream the HTTP response and pack pixels directly into
  the panel buffer via `display_driver_render_pf7a_url()`. A 1 KB I/O
  buffer is used; the 16 KB mbedTLS record buffer must be preserved
  (don't enable `CONFIG_MBEDTLS_DYNAMIC_BUFFER`).

## Communication / app-layer context

Kept here for reference; ESPHome replaces most of this with native
components, but the wire shape is useful when wiring up a custom
`media_source` or HTTP-triggered automation.

- WebSocket: `wss://<host>/ws`
  - Headers: `Authorization: Bearer <authKey>`
  - Fallback: `?token=<authKey>` query param
  - Push envelopes: `{ cursor: <int64>, message: { type, ... } }`
- HTTP endpoints (all use Bearer auth):
  - `POST /api/frame/hello` body: `{ protocolVersion, heartbeatEvery }`
    → returns initial snapshot
  - `GET  /api/frame/snapshot`
  - `GET  /api/frame/events?after=<cursor>&wait=<ms>` (long-poll)
  - `POST /api/frame/ack` body: `{ cursor }`
  - `POST /api/frame/state` body: `{ status, heartbeatEvery, cursor }`
- Heartbeat cadence: 60 s (fixed; image rotation cadence is
  server-decided)
- Device-side: heartbeat pauses the WebSocket to free mbedTLS heap for
  the HTTPS heartbeat call (ESP32-C6 specific; safe to keep in
  ESPHome by using `http_request` rather than concurrent TLS)
- Server message types: `display` (carries `artifactKey` + `requestId`),
  `command` (carries `reboot`, `refreshNow`, `syncNow`)

### Persistence

- NVS namespace: `frame_cfg`
- Keys: `wifi_ssid`, `wifi_pw`, `frame_auth`
- ESPHome equivalent: `esp32_pref` / `globals` / `wifi` credentials

### BLE provisioning (replaced in ESPHome)

- NimBLE, service UUID `0xec00`, characteristic UUID `0xec0e` (write)
- Advertised device name: `PictureFrame`
- Payload format: `{ type: "wifiProvision", ssid, password, authKey }`
- ESPHome equivalents: `improv_wifi` (captive portal over BLE) or
  `wifi:` + `captive_portal:`. The web `/connect` page becomes an
  ESPHome `web_server` form.

## ESPHome porting checklist

- [ ] `esp32:` board with `variant: esp32c6` (or `esp32s3`)
- [ ] `spi:` bus on the same pins, software-CS (set `cs_pin:` and ensure
      the custom display component drives it manually)
- [ ] Custom `display:` platform reproducing the init sequence and
      per-frame protocol above (ESPHome's bundled `Waveshare EPaper
    7.3in (S) 800x480` uses a different opcode set — do not assume
      it's a drop-in)
- [ ] `output:` style framebuffer of 192,000 bytes, DMA-capable
- [ ] Color mapping table: 0–6 → `Color::BLACK/WHITE/GREEN/BLUE/RED/YELLOW/ORANGE`
- [ ] BUSY pin with `internal_pullup: true`, idle-high polling,
      ~30 s timeout, timed fallback at 250 ms / 18 s
- [ ] Replace BLE provisioning with `improv_wifi` (or `captive_portal`)
- [ ] Replace WebSocket + `/api/frame/hello` flow with `http_request` +
      `interval:` automation, or a custom `media_source` if you want
      push-style updates
- [ ] Decode `PF7A` → palette indices → pack 2pp → display component
- [ ] `wifi:` + auth key sourced from `secrets.yaml` (or persisted via
      `esp32_pref`)

## Monochrome panel variant (untested)

> **Untested.** This section sketches how the same wiring and app-layer
> code could drive a 1-bit (black/white) e-paper panel — e.g. a
> Waveshare 7.5" HD or 10.3" monochrome display — instead of the
> 7-color panel the current firmware targets. None of the values below
> have been validated against real hardware; treat them as a starting
> point for a custom display platform, not a copy-paste config.

### What stays the same

- **Pin map** for SPI, CS, DC, RST, BUSY is the same; monochrome panels
  from Waveshare and Good Display use the same 4-line SPI conventions.
- **3.3 V power** and `GND` wiring are unchanged.
- **BLE provisioning** / NVS / app layer (WebSocket + `/api/frame/hello`
  - `PF7A` decoder) is unchanged — the server still ships the same
    artifact format.
- **BUSY pin behavior** is functionally identical: idle-high,
  open-drain (pull-up required), wait with timed fallback.

### What changes

- **Pixel packing drops to 1 bit per pixel**. Buffer size becomes
  `800 * 480 / 8 = 48,000` bytes for 800×480, or `1200 * 825 / 8` for a
  1200×825 panel. The DMA-capable buffer requirement is unchanged.
- **7-color palette disappears.** Each palette index from the `PF7A`
  payload has to be reduced to 1 bit. The simplest dither-free mapping
  is luminance-based, e.g.:

  ```python
  # 0 black, 1 white, 2 green, 3 blue, 4 red, 5 yellow, 6 orange
  luminance = {
      0: 0.00,  # black
      1: 1.00,  # white
      2: 0.55,  # green
      3: 0.30,  # blue
      4: 0.30,  # red
      5: 0.75,  # yellow
      6: 0.55,  # orange
  }
  ```

  Threshold at `0.5` for black/white. For better quality, use
  Floyd–Steinberg dithering when converting the 7-color framebuffer
  to 1-bit — the server or a custom ESPHome component can do this.

- **Init sequence** is panel-specific. Common monochrome Waveshare
  panels use a different opcode set (e.g. `0x12` for `DISPLAY_REFRESH`
  is universal, but `0x01`, `0x03`, `0x04`, `0x50`, `0x61` values all
  change). Look up the exact sequence in the panel's datasheet and
  drop it into the custom display platform. The 800×480 resolution
  value in `0x61` is replaced by your panel's width/height.
- **Refresh time is much shorter** for monochrome panels. A full
  refresh on a 7.5" HD monochrome panel is typically 2–4 s rather than
  18 s. Partial refresh is often supported (opcodes vary, e.g. `0x16`
  for `PARTIAL_REFRESH` on some panels). The 18 s fallback in the
  busy-wait logic should be tuned down to the panel's actual
  worst-case refresh.
- **Frame format on the wire (`PF7A`) does not change** — the server
  keeps shipping 7-color images. The conversion to 1-bit happens on
  the device, either in the custom display component or in a thin
  intermediate "PF7A → 1bpp" transform step. This keeps the server
  generic and lets monochrome clients dither however they want.

### ESPHome sketch (pseudo-config)

```yaml
esp32:
  board: xiao_esp32c6
  variant: esp32c6

spi:
  clk_pin: GPIO19
  mosi_pin: GPIO18

# CS, DC, RST, BUSY are managed by the custom display platform below,
# not the spi: bus (CS is software-controlled, same as the 7-color firmware).

display:
  - platform: waveshare_epaper_mono_hd # placeholder — likely a custom platform
    id: frame
    model: 7.5in-hd # 1200x825, or pick the panel you have
    cs_pin: GPIO1
    dc_pin: GPIO21
    reset_pin: GPIO0
    busy_pin:
      number: GPIO23
      inverted: false
      internal_pullup: true
    # full_update_interval: never        # server-driven via PF7A updates
    # lambda triggers a custom action that pulls + decodes PF7A on demand
```

In practice the upstream `waveshare_epaper_*` components assume
ESPHome's own image pipeline. Because the server pushes `PF7A` (not a
JPEG/PNG), you'll almost certainly need a **custom display platform**
that:

1. Exposes a `Buffer` of the panel's native size (1bpp).
2. Provides a `show()` action the app layer calls after decoding
   `PF7A` → palette indices → 1bpp.
3. Implements the panel-specific init sequence and per-frame
   `0x10` (write) / `0x12` (refresh) flow with a refreshed
   busy-wait timeout.

### Dithering (recommended for art / photos)

A 7-color image reduced to 1-bit without dithering looks harsh. Add a
Floyd–Steinberg pass in the converter:

- Strength: standard (error diffusion matrix `[0, 0, 7; 3, 5, 1] / 16`)
- Luminance weights: ITU-R BT.601 (`0.299 R + 0.587 G + 0.114 B`)
- Process in row-major order over the 7-color framebuffer
- Output directly into the 1bpp panel buffer

This can run in a few hundred ms on the ESP32-C6 for a 1200×825 image
and is a strict improvement over thresholding for non-geometric art.

## Build / flash (current ESP-IDF version, for reference)

```bash
. ~/esp/esp-idf/export.sh
cd esp32-firmware
idf.py set-target esp32c6   # or esp32s3
idf.py menuconfig            # set WS / asset base URLs
idf.py build
idf.py -p /dev/ttyACM0 flash
idf.py -p /dev/ttyACM0 monitor
```

Required `menuconfig` values:

- `PictureFrame settings → WebSocket base URL`
- `PictureFrame settings → Frame asset base URL`
- (optional) `PictureFrame settings → Default frame auth key`

If `idf.py: command not found` — source the ESP-IDF environment first
(`. ~/esp/esp-idf/export.sh`).
