import mqtt from 'mqtt';
import { env } from '$env/dynamic/private';

export const mqttClient = mqtt.connect({
    host: env.MQTT_HOST,
    port: 8883,
    protocol: 'mqtts',
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD
});

export const commands = {
    update: "update",
    commands: "commands"
}

export function sendMqtt(topic: string, body: string) {
    return new Promise<{ err: any, packet: any }>(res => mqttClient.publish(topic, body, { qos: 2 }, (err, packet) => res({ err, packet })));
}