import { env } from '$env/dynamic/private';
import { commands, sendMqtt } from '$lib/mqtt';
import { s3Client } from '$lib/s3';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	if (body.key) {
		const res = await sendMqtt(commands.update, body.key);
		console.log(res);
		return new Response(JSON.stringify(res));
	}

	console.log('sent key', body.key);

	return new Response();
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = await request.json();

	// TODO: input validation

	const command = new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: body.key });
	await s3Client.send(command);
	return new Response();
};
