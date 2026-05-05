// @ts-check

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const mqtt = require('mqtt');
const { setTimeout } = require('node:timers/promises');

let randomKey = "";

const client = mqtt.connect({
    host: '25db2de3864c403ab32418211bfc5403.s2.eu.hivemq.cloud',
    port: 8883,
    protocol: 'mqtts',
    username: "raspi",
    password: "XU3wY6sQ5km_!_v"
})

const s3Client = new S3Client({
    endpoint: "https://fra1.digitaloceanspaces.com",
    forcePathStyle: false,
    region: "us-east-1",
    credentials: {
        accessKeyId: "DO00HUAFC74PTA87RJKC",
        secretAccessKey: "NiWDn7jCdB1HANaoYh7AJ0NOn0JBEqsyXjFsudZRYNI"
    }
});

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