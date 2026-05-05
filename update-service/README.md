# Legacy Pi E-Ink Display Test

This is the minimal setup for testing whether the Raspberry Pi Zero W can still drive the Waveshare 7.3 inch 7-color e-ink display. It does not require the Node update service, BLE, MQTT, S3, or `npm install`.

## Fresh Pi OS Setup

Use Raspberry Pi OS Lite 32-bit. For a Pi Zero W 1, prefer the Legacy/Bullseye Lite image if available.

Enable SSH and configure Wi-Fi in Raspberry Pi Imager. If using USB gadget access, add this to `config.txt` on the boot partition:

```conf
dtoverlay=dwc2
```

Add this to `cmdline.txt` after `rootwait`, keeping the whole file as one line:

```text
modules-load=dwc2,g_ether
```

## Install System Dependencies

On the Pi:

```bash
sudo apt-get update
sudo apt-get install -y git build-essential make wget
sudo raspi-config nonint do_spi 0
sudo reboot
```

After reconnecting, install the BCM2835 library:

```bash
cd ~
wget http://www.airspayce.com/mikem/bcm2835/bcm2835-1.71.tar.gz
tar zxvf bcm2835-1.71.tar.gz
cd bcm2835-1.71/
sudo ./configure
sudo make
sudo make check
sudo make install
```

## Build The Display Binary

Clone this repo and build the e-ink test binary:

```bash
cd ~
git clone https://github.com/poesterlin/PictureFrame.git DitherSubmitions
cd ~/DitherSubmitions/update-service/e-inc/c
sudo make clean || true
sudo make EPD=epd7in3f
```

The `Makefile` defaults to `EPD=epd7in3f`, but passing it explicitly documents the target display.

## Load A Test Image

The binary reads this file:

```text
~/DitherSubmitions/update-service/e-inc/c/pic/img.txt
```

Copy one backed-up `.txt` image into that exact path. From your laptop, for example:

```bash
scp /home/philip/git/PictureFrame/pi-output-backup-2026-05-05/<image-file>.txt pi@raspberrypi.local:/home/pi/DitherSubmitions/update-service/e-inc/c/pic/img.txt
```

Or on the Pi, if the file is already present under `update-service/output/`:

```bash
cp ~/DitherSubmitions/update-service/output/<image-file>.txt ~/DitherSubmitions/update-service/e-inc/c/pic/img.txt
```

## Run The Display Test

Run from the `e-inc/c` directory so `./pic/img.txt` resolves correctly:

```bash
cd ~/DitherSubmitions/update-service/e-inc/c
sudo ./epd
```

Expected output includes:

```text
EPD_7IN3F_test Demo
bcm2835 init success !!!
e-Paper Init and Clear...
show bmp1-----------------
file length 384000
!!! errors = 0 !!!
Goto Sleep...
```

If `bcm2835 init` fails, check that SPI is enabled and rebooted. If it hangs at `Debug: e-Paper busy`, check display power, ribbon orientation, HAT connection, and GPIO/SPI wiring.
