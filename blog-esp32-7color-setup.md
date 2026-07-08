# Wiring a 7-Color E-Ink Panel to an ESP32-C6 Without Losing Your Mind

There's a surprise lack of cohesive documentation on driving a Waveshare 7.3-inch 7-color panel from an ESP32. Waveshare gives you a Raspberry Pi Python script with an init sequence buried in a 2000-line vendor blob. ESP-IDF ships no driver for it. The 7-color panel is a different beast from the standard black/white/red tri-color displays — it uses the ACeP (Advanced Color ePaper) protocol with per-pixel palette indices, not bitplanes.

This post covers what I learned building a firmware that drives the panel from a XIAO ESP32-C6.

---

## The Hardware

Panel: Waveshare 7.3-inch 7-color e-ink (800x480). The 7 colors are black, white, green, blue, red, yellow, orange.

MCU: XIAO ESP32-C6. Also tested on ESP32-S3. The C6 has less RAM which forces design decisions (more on that later).

Connection: The panel runs in 4-line SPI mode with separate DC (data/command), CS (chip select), RST (reset), and BUSY control lines. 3-line SPI mode will not work.

## The Pinout That Actually Works

This is the #1 source of frustration. XIAO board silkscreen labels (D7, D8, D9, D10) do **not** correspond to ESP32 GPIO numbers. `D8` is not GPIO 8. Here's the wiring:

```
Panel Pin        XIAO Silkscreen    Actual ESP32 GPIO
────────────────────────────────────────────────────
VCC              3V3                -
GND              GND                -
SCLK             D8                 GPIO 19
DIN (MOSI)       D10                GPIO 18
CS               D1                 GPIO 1
DC               D3                 GPIO 21
RST              D0                 GPIO 0
BUSY             D5                 GPIO 23
```

BUSY is configured as input with internal pull-up enabled. Some Waveshare-compatible boards expose BUSY as open-drain and **will not assert** without a pull-up. If BUSY always reads high (or always low) across every phase of a refresh, this is the problem.

---

## The Panel Buffer: Nibble-Packed

The firmware doesn't send one byte per pixel to the panel. It packs 2 pixels per byte because palette values are 0-6 (fits in 4 bits):

```
  byte 0      byte 1      byte 2      ...
+-----+-----+-----+-----+-----+-----+
|px 0 |px 1 |px 2 |px 3 |px 4 |px 5 |
|hi 4 |lo 4 |hi 4 |lo 4 |hi 4 |lo 4 |
+-----+-----+-----+-----+-----+-----+
```

Buffer size: (800/2) \* 480 = 192,000 bytes, not 384,000. Even-indexed pixels go in the high nibble, odd-indexed pixels in the low nibble.

The buffer must be allocated with `MALLOC_CAP_DMA | MALLOC_CAP_8BIT` so the ESP-IDF SPI DMA engine can read from it directly. A regular heap buffer will cause SPI transaction errors.

The SPI clock is set to 2 MHz — conservative for jumper wires. You can push it to 10-20 MHz with a PCB or short, clean connections.

---

## The 7 Colors and How the Firmware Uses Them

The panel controller recognizes 7 palette indices. The firmware passes raw index values (0-6) to the controller with no palette lookup or remapping in between:

```
Index 0: Black          RGB   0,   0,   0
Index 1: White          RGB 255, 255, 255
Index 2: Green          RGB   0, 255,   0
Index 3: Blue           RGB   0,   0, 255
Index 4: Red            RGB 255,   0,   0
Index 5: Yellow         RGB 255, 255,   0
Index 6: Orange         RGB 255, 128,   0
```

The firmware does exactly zero color translation — whatever index you put in the packed buffer is what the panel renders. If your image pipeline encodes white as index 0 and black as index 1, the panel will display black and white swapped. There's a safety net that clamps out-of-range values (>= 7) to white, but that's for malformed data, not something to rely on.

---

## The Panel Init Sequence

Waveshare's Raspberry Pi drivers load `.lut` files at runtime. You don't need those. The entire init sequence can be hardcoded as a flat list of register writes — about 80 lines.

### Register Map

```
0xAA: Panel configuration
     data: 0x49, 0x55, 0x20, 0x08, 0x09, 0x18

0x01: Gate driver output control
     data: 0x3F, 0x00, 0x32, 0x2A, 0x0E, 0x2A

0x00: Panel setting
     data: 0x5F, 0x69

0x03: VCOM configuration
     data: 0x00, 0x54, 0x00, 0x44

0x05: Color LUT — voltage level 1
     data: 0x40, 0x1F, 0x1F, 0x2C

0x06: Color LUT — voltage level 2
     data: 0x6F, 0x1F, 0x16, 0x25

0x08: Color LUT — voltage level 3
     data: 0x6F, 0x1F, 0x1F, 0x22

0x61: Resolution
     data: 0x03, 0x20, 0x01, 0xE0
     (0x0320 = 800, 0x01E0 = 480)

0xE0, 0xE3, 0xE6: Additional panel config

0x41: Gate source start
     data: 0x00

0x50: VCOM and data interval
     data: 0x3F

0x60: TCON setting
     data: 0x02, 0x00

0x82: VCOM_DC setting
     data: 0x1E
```

If you're adapting this for a different panel size, register 0x61 is where resolution is set. The format is (X_high, X_low, Y_high, Y_low) in hex.

The registers 0x05, 0x06, and 0x08 control the voltage look-up tables for the 7 colors. These are the "secret sauce" that makes the color reproduction work. Wrong values here and colors come out washed out, too dark, or the panel won't refresh at all. These were reverse-engineered from the Waveshare driver and are specific to the 7.3-inch ACeP panel. If you're porting to a different size, you need the LUT values for that specific panel.

### Pre-Init: Reset the Controller

Before sending any register writes, you must pulse the RST pin:

```
RST high → wait 20ms → RST low → wait 10ms → RST high → wait 20ms
```

Then wait for BUSY to return to idle level before beginning the register sequence.

---

## The Display Refresh Cycle

The panel refresh follows a strict command sequence:

```
1. Send command 0x10 (write frame data)
   → Stream all 480 rows of packed pixel data over SPI
   → 400 bytes per row (800 pixels, 2 per byte)
   → Yield every 8 rows to keep the watchdog fed

2. Send command 0x04 (power on)
   → Wait for BUSY to de-assert (or 250ms fallback)

3. Send command 0x12 (display refresh — triggers the actual update)
   → Send data byte 0x00 as parameter
   → Wait for BUSY to de-assert (or 18 second fallback)

4. Send command 0x02 (power off)
   → Send data byte 0x00 as parameter
   → Wait for BUSY to de-assert (or 250ms fallback)
```

Full 7-color refresh takes ~15-18 seconds. This is normal. The ACeP controller cycles through multiple voltage levels to achieve the 7-color gamut. It's slower than tri-color and dramatically slower than black-and-white. Not a bug.

---

## BUSY Line Handling

The BUSY pin tells you when the panel controller is done processing a command. The firmware has a diagnostic approach:

**Probe phase (500ms):** After sending a command that triggers panel activity, the firmware watches BUSY for activity. If the line asserts (leaves idle) within 500ms, it then waits until BUSY returns to idle. If BUSY _never_ asserts during the probe window, the firmware switches to a timed fallback — it uses fixed millisecond delays instead of polling the pin.

**Sample logging:** At 8 time points (0µs, 1ms, 5ms, 20ms, 100ms, 500ms, 2s, 5s), the firmware reads BUSY and logs the levels:

```
busy samples (us:lvl): 0:1 1k:1 5k:1 20k:1 100k:1 500k:1 2M:1 5M:1
BUSY never asserted, switching to timed fallback
```

If you see all `1`s (or all `0`s) across every sample — BUSY is floating. The line isn't connected or the pull-up isn't working.

**Timeout:** When BUSY is functional and the firmware is actively waiting on it, there's a 30-second timeout. If BUSY doesn't return to idle within 30 seconds, the firmware logs an error with the current pin level.

**Fallback delays:**

- POWER_ON / POWER_OFF: 250ms
- DISPLAY_REFRESH: 18 seconds (deliberately conservative)

Once the fallback is triggered, all future cycles use fixed delays. The panel still works fine, just with slower-than-necessary timing.

---

## SPI Details

```
Bus:      SPI2_HOST (FSPI)
Mode:     0 (CPOL=0, CPHA=0)
Clock:    2 MHz (conservative)
CS:       Software-controlled (not hardware CS)
DMA:      Auto-channel
Queue:    1 transaction
Max transfer size: 4096 bytes
```

CS is controlled manually by toggling the GPIO, not by the SPI peripheral. This is why the clock stays low — software CS over jumper wires introduces jitter. The pattern for every SPI transaction:

```
DC low  → select command mode
CS low  → assert chip select
SPI write command byte
CS high → de-assert

DC high → select data mode
CS low  → assert chip select
SPI write data in 512-byte chunks
CS high → de-assert
```

Data for the frame write (0x10) is sent row-by-row. Each row is 400 bytes. Long rows are split into 512-byte SPI transactions internally.

---

## Memory Constraints on the ESP32-C6

The C6 has tight heap. A few strategies make it work:

**Nibble-packing halves the buffer.** Without it, the panel would need a 384KB frame buffer. Packed, it's 192KB — still large but workable.

**DMA-capable allocation.** The buffer is explicitly allocated from DMA-capable memory. If you allocate from the regular heap and pass it to SPI DMA, you'll get `ESP_ERR_INVALID_ARG` or silent data corruption.

**Serialized TLS operations.** The C6 can't handle two concurrent TLS handshakes — the PSA crypto memory runs out. The firmware avoids this by never doing an HTTPS download while the WebSocket (also TLS) is active. One or the other, never both. This is a C6-specific limitation; the S3 handles it more gracefully.

**No concurrent renders.** If a display update is already in progress, incoming requests are dropped. Two simultaneous panel refreshes would both try to use the same DMA buffer and SPI bus.

---

## Troubleshooting Checklist

**Display doesn't change after first render attempt:**

- Verify the pin mapping. XIAO silkscreen labels are not GPIO numbers. GPIO 19 is D8, GPIO 18 is D10.
- Check serial output for "display initialized for Waveshare 7.3in 7-color". If that line doesn't appear, SPI bus or GPIO init failed.
- Power: the panel draws significant current during refresh. A brownout will cause silent failures with no error logged.
- Test with a solid-color fill to isolate whether it's a panel issue or a data/content issue.

**BUSY always reads the same level:**

- BUSY is floating or miswired. The firmware auto-falls back to timed delays and will work, just at conservative speeds.
- Verify pull-up is enabled on the BUSY GPIO.

**Colors are wrong or black-white swapped:**

- Your image pipeline uses the wrong palette index ordering. The panel expects black=0, white=1. There's no translation layer — fix the encoder.

**SPI bus errors or garbage on screen:**

- 2 MHz with jumper wires is usually reliable. If you see corruption, check SCLK and MOSI connections first. The CS and DC lines being swapped is a common mistake.
- If you raised the clock speed, shorter wires or a PCB are necessary.

**Refresh takes 18 seconds:**

- Normal for 7-color ACeP. The panel cycles through multiple voltage levels per color channel.

**Crashes during image download or periodic operations:**

- TLS heap exhaustion. Make sure only one TLS connection is active at a time. On the C6, this means pausing the WebSocket before making any HTTPS call.

---

## Init Sequence Quick Reference

If you're writing your own driver and just need the register dump, here's the complete initialization (send each register + data, waiting for BUSY between writes where noted):

```
RST pulse (high 20ms, low 10ms, high 20ms) + wait for BUSY idle + 30ms delay

0xAA: 0x49, 0x55, 0x20, 0x08, 0x09, 0x18
0x01: 0x3F, 0x00, 0x32, 0x2A, 0x0E, 0x2A
0x00: 0x5F, 0x69
0x03: 0x00, 0x54, 0x00, 0x44
0x05: 0x40, 0x1F, 0x1F, 0x2C
0x06: 0x6F, 0x1F, 0x16, 0x25
0x08: 0x6F, 0x1F, 0x1F, 0x22
0x13: 0x00, 0x04
0x30: 0x02
0x41: 0x00
0x50: 0x3F
0x60: 0x02, 0x00
0x61: 0x03, 0x20, 0x01, 0xE0
0x82: 0x1E
0x84: 0x00
0x86: 0x00
0xE3: 0x2F
0xE0: 0x00
0xE6: 0x00
```

Then the panel is ready for frame data. Send 0x10 followed by 192,000 bytes of packed pixel data (nibble pairs), then trigger the refresh with 0x04 → 0x12 → 0x02, waiting for BUSY between each.

---

The 7-color panel is a sharp display once you understand the init sequence and the nibble-packed SPI protocol. The undocumented part was always about which registers matter, why the color LUT values (0x05/0x06/0x08) are critical, and why the BUSY line needs a pull-up. Now you know all three.
