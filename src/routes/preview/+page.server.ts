import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { PageServerLoad } from './$types';
import { s3Client } from '$lib/s3';
import { env } from '$env/dynamic/private';


export const prerender = false;

export const load: PageServerLoad = async () => {
	const command = new ListObjectsV2Command({
		Bucket: env.S3_BUCKET
	});

	const list = await s3Client.send(command);
	if (!list.Contents) {
		return;
	}

	const keys = list.Contents
		.filter((c) => !!c.Key && c.Key.includes('.txt'))
		.sort((c1, c2) => c2.LastModified!.getTime() - c1.LastModified!.getTime())
		.map((c) => c.Key!);

	return { keys }
};


