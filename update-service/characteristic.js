const bleno = require("@abandonware/bleno");
const childProcess = require('child_process');
const { readFile } = require("fs");
const fs = require("fs/promises");
const { join } = require("path");

class EchoCharacteristic extends bleno.Characteristic {
    constructor() {
        super({
            uuid: 'ec0e',
            properties: ['read', 'write', 'notify'],
            value: null
        });

        this._value = new Buffer(0);
        this._updateValueCallback = null;
    }

    onReadRequest(offset, callback) {
        console.log('EchoCharacteristic - onReadRequest: value = ' + this._value.toString('hex'));

        callback(this.RESULT_SUCCESS, this._value);
    }

    onWriteRequest(data, offset, withoutResponse, callback) {
        this._value = data;

        try {
            console.log('decoding data')
            const data = decodeData(this._value);
            writeWifiConfiguration(data)
        } catch (e) {
            console.log('error', e)
        }

        console.log('EchoCharacteristic - onWriteRequest: value = ' + this._value.toString('hex'));

        if (this._updateValueCallback) {
            console.log('EchoCharacteristic - onWriteRequest: notifying');

            this._updateValueCallback(this._value);
        }

        callback(this.RESULT_SUCCESS);
    }

    onSubscribe(maxValueSize, updateValueCallback) {
        console.log('EchoCharacteristic - onSubscribe');

        this._updateValueCallback = updateValueCallback;
    }

    onUnsubscribe() {
        console.log('EchoCharacteristic - onUnsubscribe');

        this._updateValueCallback = null;
    }
}


function decodeData(value) {
    const decoder = new TextDecoder();
    const decoded = decoder.decode(value);
    const decodedObject = JSON.parse(decoded);
    console.log('decoded', decodedObject)
    return decodedObject;
}

async function writeWifiConfiguration(config) {
    if (!config.ssid || !config.password) {
        console.log('no ssid or password')
        return;
    }

    const wifiConfig = `ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
    update_config=1
    network={
        ssid="${config.ssid}"
        psk="${config.password}"
    }`.replace(/\n/g, "\n");

    await fs.writeFile("./config", wifiConfig);

    const file = "/etc/wpa_supplicant/wpa_supplicant.conf";
    childProcess.exec(`sudo cp ./config ${file}`, function (msg) { console.log(msg) });

    await new Promise(resolve => setTimeout(resolve, 1000));

    childProcess.exec(`sudo cat ${file}`, function (msg) { console.log(msg) });

    await new Promise(resolve => setTimeout(resolve, 1000));
    await reboot();
}

async function reboot() {
    childProcess.exec('sudo /sbin/shutdown -r now', function (msg) { console.log(msg) });
}

class ReadLogCharacteristic extends bleno.Characteristic {
    constructor() {
        super({
            uuid: 'ec0f',
            properties: ['read', 'notify'],
            value: null
        });

        this._value = new Buffer(0);
        this._updateValueCallback = null;
    }

    onReadRequest(offset, callback) {
        const maxLength = 512;
        const logFile = join(__dirname, 'log.txt');
        readFile(logFile, (err, data) => {
            if (err) throw err;
            if (data.length > maxLength) {
                data = data.subarray(data.length - maxLength);
            }

            callback(this.RESULT_SUCCESS, data);
        });
    }

    onSubscribe(maxValueSize, updateValueCallback) {
        console.log('ReadLogCharacteristic - onSubscribe');

        this._updateValueCallback = updateValueCallback;
    }

    onUnsubscribe() {
        console.log('ReadLogCharacteristic - onUnsubscribe');

        this._updateValueCallback = null;
    }
}

module.exports = {
    EchoCharacteristic,
    ReadLogCharacteristic
}