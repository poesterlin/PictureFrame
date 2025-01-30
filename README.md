# Image Display

This project includes a web interface to process and upload images to an e-ink display. The display is connected to a raspberry pi and the images are processed using a c program. The web interface is written in svelte. It uploads images to an s3 bucket and sends a message to the raspberry pi using the mqtt protocol to update the display. There are also controls included that have various administrative functions, like sending the wifi credentials to the raspberry pi over using the web-bluetooth api. The display is only able to display 7 colors and has a resolution of 800x600 pixels. The images are processed using a dithering algorithm to convert the images to the 7 colors. The dithering algorithm is quite expensive to run so the website is using a web worker with the help of the Comlink Library to do the processing.

## Frontend

To run the frontend you need to have nodejs installed.

Configure the environment variables in the `.env` file then run the following commands.

```bash
npm install
npm run dev
```

## Raspberry Pi Setup

- install github cli installation instructions [here](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian-ubuntu-linux-raspberry-pi-os-apt)
- enable i2c in raspy-config

### install libs

```
cd ~
wget http://www.airspayce.com/mikem/bcm2835/bcm2835-1.71.tar.gz
tar zxvf bcm2835-1.71.tar.gz
cd bcm2835-1.71/
sudo ./configure && sudo make && sudo make check && sudo make install
```

```bash
git clone ...
sudo npm i pm2 -g
cd DitherSubmitions/update-service

chmod +x run.sh
sudo ./run.sh
```

### setup cron job to run on startup

```bash
echo "0 4 * * * root $(pwd)/update-service/run.sh" > /etc/cron.d/updater
echo "/bin/sleep 60 && /usr/sbin/service cron start" > /etc/rc.local
```

### install nodejs 14 on the raspberry pi

The latest version of node i could get to work on the raspberry pi zero is 14.13.0. The following commands will install node 14.13.0 on the raspberry pi zero.

```
    wget https://unofficial-builds.nodejs.org/download/release/v14.13.0/node-v14.13.0-linux-armv6l.tar.xz
    tar xvfJ <file.tar.xz>
    sudo cp -R <extracted tar folder>/* /usr/local
    rm -rf node-*
    sudo reboot
    node -v && npm -v

    sudo apt-get update

    wget http://www.airspayce.com/mikem/bcm2835/bcm2835-1.71.tar.gz
    tar zxvf bcm2835-1.71.tar.gz
    cd bcm2835-1.71/
    sudo ./configure && sudo make && sudo make check && sudo make install
    cd ~

    sudo apt-get install git -y
    git clone ...
    git pull
    cd e-inc/c
    sudo make
    cd ~

    wget https://unofficial-builds.nodejs.org/download/release/v14.13.0/node-v14.13.0-linux-armv6l.tar.xz
    tar xvfJ node-v14.13.0-linux-armv6l.tar.xz
    sudo cp -R node-v14.13.0-linux-armv6l/* /usr/local
    rm -rf node-*
    sudo reboot
    node -v && npm -v

    cd DitherSubmitions/
    cd update-service/
    npm i

```

input: `node ~/DitherSubmitions/update-service/index.js &`
follow `https://netzmafia.ee.hm.edu/skripten/hardware/RasPi/RasPi_Auto.html`

## Bluetooth LE on the raspberry pi

`https://entwickler.de/iot/wir-mussen-reden-002`

```
sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev

```

### setup cron job to run on startup

script to run

```
sudo crontab -e

enter:
@reboot /usr/local/bin/node /home/pi/DitherSubmitions/update-service/index.js >> /home/pi/error.txt 2>&1

```
