import { env } from "$env/dynamic/private";
import { S3Client } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({
    endpoint: 'https://fra1.digitaloceanspaces.com',
    forcePathStyle: false,
    region: 'us-east-1',
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY
    }
});
