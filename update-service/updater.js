// @ts-check

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const mqtt = require('mqtt');
const { setTimeout } = require('node:timers/promises');

// load environment variables from .env file
require('dotenv').config();

let randomKey = "";
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

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }

    return condition;
}

async function update() {
    const command = new ListObjectsV2Command({
        Bucket: "ditheringsubmitions",
    });

    const response = await s3Client.send(command);
    if (!response.Contents) {
        return;
    }

    const keys = response.Contents.filter(c => !!c.Key).map(c => c.Key || '')
    const random = Math.floor(Math.random() * keys.length);
    randomKey = keys[random];
}

update();

setTimeout(4 * 60 * 1000).then(async () => {
    client.publish("update", randomKey)
    await setTimeout(3000);
    console.log("shutdown");
    process.exit(0);
})

client.on("connect", () => client.subscribe("update"))

client.on('message', async function (topic, _message) {
    if (topic !== "update") {
        return;
    }

    console.log("abort for new image");
    process.exit(0);
})