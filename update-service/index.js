/* eslint-disable @typescript-eslint/no-var-requires */
// @ts-check
const mqtt = require('mqtt');
const axios = require('axios');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const bleno = require('@abandonware/bleno');
const { EchoCharacteristic, ReadLogCharacteristic } = require('./characteristic');

const { exec } = require('child_process');
const { writeFile, readFile, access, mkdir, readdir } = require('fs/promises');
const { copyFileSync, unlinkSync } = require('fs');
const { join } = require('path');

// load environment variables from .env file
require('dotenv').config();

let displaying = false;
let timeout;
let refreshEvery;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }

    return condition;
}

const client = mqtt.connect({
	host: assert(process.env.MQTT_HOST),
	port: assert(process.env.MQTT_PORT),
	protocol: 'mqtts',
	username: assert(process.env.MQTT_USERNAME),
	password: assert(process.env.MQTT_PASSWORD)
})

const s3Client = new S3Client({
	endpoint: process.env.S3_ENDPOINT,
	forcePathStyle: false,
	region: process.env.S3_REGION,
	credentials: {
		accessKeyId: assert(process.env.S3_ACCESS_KEY_ID),
		secretAccessKey: assert(process.env.S3_SECRET_ACCESS_KEY),
	}
});

const output = join(__dirname, "/output")
const logFile = join(__dirname, 'log.txt');
function log(...msg) {
	console.log(...msg);
	const date = new Date();
	writeFile(logFile, `${date.toISOString()} ${msg.join(' ')}\n`, { flag: 'a' });
}

async function clearLog() {
	await writeFile(logFile, '');
}

client.on('connect', () => {
	client.subscribe({ 'update': { qos: 0 }, 'commands': { qos: 2 } });
});

client.on('message', async function (topic, message) {
	log(topic);
	const msg = message.toString();
	if (topic === 'update' && !displaying) {
		await display(msg);
	}

	if (topic === 'commands') {
		const settings = JSON.parse(msg);


		if (settings.reboot) {
			log('rebooting');
			await reboot();
		}
		if (settings.refreshNow) {
			log('refreshing');
			refreshNow();
		}
		if (settings.refreshEvery !== undefined && settings.refreshEvery !== refreshEvery && settings.refreshEvery > 0) {
			refreshEvery = settings.refreshEvery;
			log('set refresh to', refreshEvery);
			await writeFile(join(__dirname, 'refresh.txt'), refreshEvery + '');
			refreshNow();
		}
		if (settings.download) {
			log('downloading all');
			await downloadAll();
		}
		if (settings.clearLog) {
			log('clearing log');
			await clearLog();
			log('cleared log');
		}
	}
});

clearLog()
	.then(() => log('cleared log'))
	.then(() => access("refresh.txt"))
	.then(() => {
		return readFile(join(__dirname, 'refresh.txt')).then((val) => {
			refreshEvery = parseInt(val.toString());
			log('refresh every', refreshEvery);
			refreshNow();
		});
	}).catch(async () => {
		refreshEvery = 600;
		await writeFile(join(__dirname, 'refresh.txt'), refreshEvery + '');
		await downloadAll();
		refreshNow();
	})


async function downloadAll() {
	try {
		const command = new ListObjectsV2Command({
			Bucket: 'ditheringsubmitions'
		});

		const response = await s3Client.send(command);
		if (!response.Contents) {
			throw new Error("no contents");
		}
		const keys = response.Contents.filter((c) => !!c.Key && c.Key.includes(".txt")).map((c) => c.Key || '');
		log("found keys: ", keys.length);

		await mkdirIfNotExists(output);
		for (const key of keys) {
			await download(key);
		}

		const files = await readdir(output);
		for (const file of files) {
			if (!keys.some(k => k.endsWith(file))) {
				log("deleting", file);
				unlinkSync(join(output, file));
			}
		}

	} catch (e) {
		log(e);
	}
}

function refreshNow() {
	if (displaying) {
		return;
	}
	createShuffle(1);
}

async function reboot() {
	log('rebooting in 5 minutes');
	const timeoutSeconds = 1000 * 60 * 5 ; // 5 minutes
	await new Promise((res) => setTimeout(res, timeoutSeconds));
	log('rebooting now');
	require('child_process').exec('sudo /sbin/shutdown -r now', function (msg) { log(msg) });
}

function createShuffle(time = refreshEvery) {
	if (timeout) {
		clearTimeout(timeout);
	}
	log('next in: ', time, 's');
	timeout = setTimeout(display, time * 1000);
}

async function download(path) {
	if (!path) {
		return;
	}

	const arr = path.split("/");
	log(arr);
	const id = arr[arr.length - 1];

	log("checking if exists", id)
	if (await fileExists(id)) {
		return id;
	}

	log("downloading", path)
	const base = process.env.S3_ENDPOINT;
	const response = await axios.get(base + path, {
		'Content-Type': 'text/plain',
		responseType: 'arraybuffer'
	});
	mkdirIfNotExists(output)
	await writeFile(join(output, id), Buffer.from(response.data), 'binary');
	return id;
}

async function pickRandomFile() {
	await mkdirIfNotExists(output);
	const files = await readdir(output);
	return files[Math.floor(Math.random() * files.length)];
}

/**
 * @param {string | undefined} id 
 */
async function display(id = undefined) {
	if (displaying) {
		return;
	}
	displaying = true;
	log('-'.repeat(50));
	log(' displaying image ');
	log('-'.repeat(50));

	try {
		if (id === undefined) {
			id = await pickRandomFile();
		} else {
			const arr = id.split("/");
			const shortId = arr[arr.length - 1];
			const exists = await fileExists(shortId);
			if (!exists) {
				await download(id);
			}
			id = shortId;
		}

		if (id === undefined) {
			await downloadAll();
			id = await pickRandomFile();
		}


		log("displaying", id);

		await copyFileSync(join(output, id), join(__dirname, 'e-inc/c/pic/img.txt'));


		const res = await new Promise((res, rej) => {
			const childProcess = exec(`cd ${join(__dirname, '/e-inc/c/')} && sudo ./epd`, (error, out, stderr) => {
				if (error) {
					rej(error);
				}

				if (stderr) {
					rej(stderr);
				}

				res(out);
			});

			childProcess.addListener("message", log)
			childProcess.stdout?.on("data", log)
		});
		log(res);
	} catch (error) {
		console.error(error);
	}
	displaying = false;
	setTimeout(() => createShuffle(), 3000);
}

process.on('uncaughtException', function (err) {
	console.error('Caught exception: ' + err);
	reboot();
});


async function mkdirIfNotExists(dirName) {
	try {
		await mkdir(dirName, { recursive: true });
	} catch (error) {
		if (error.code !== 'EEXIST') {
			throw error;
		}
	}
}

async function fileExists(id) {
	try {
		await mkdirIfNotExists(output)
		await access(join(output, id));
		return true;
	} catch (error) {
		return false;
	}
}

bleno.on('stateChange', function (state) {
	log('on -> stateChange: ' + state);

	if (state === 'poweredOn') {
		bleno.startAdvertising('Bilderrahmen', ['ec00']);
	} else {
		bleno.stopAdvertising();
	}
});

bleno.on('advertisingStart', function (error) {
	log('on -> advertisingStart: ' + (error ? 'error ' + error : 'success'));

	if (!error) {
		bleno.setServices([
			new bleno.PrimaryService({
				uuid: 'ec00',
				characteristics: [
					new EchoCharacteristic(),
					new ReadLogCharacteristic(),
				]
			})
		]);
	}
});