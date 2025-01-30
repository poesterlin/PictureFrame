import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { error, type RequestHandler } from "@sveltejs/kit";
import Jimp from "jimp";

const s3Client = new S3Client({
    endpoint: 'https://fra1.digitaloceanspaces.com',
    forcePathStyle: false,
    region: 'us-east-1',
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY
    }
});

const palette = [
    toHex(0, 0, 0),
    toHex(255, 255, 255),
    toHex(0, 255, 0),
    toHex(0, 0, 255),
    toHex(255, 0, 0),
    toHex(255, 255, 0),
    toHex(255, 128, 0)
]

function toHex(r: number, g: number, b: number) {
    const pad = (v: string) => v.padStart(2, "0")
    return parseInt(`${pad(r.toString(16))}${pad(g.toString(16))}${pad(b.toString(16))}ff`, 16)
}

function byteIdx(index: number) {
    const x = index % 800
    const y = index / 800;
    return [x, y] as [number, number]
}

export const GET: RequestHandler = async ({ url }) => {
    const key = url.searchParams.get("key");
    const divisions = dev ? 1 : 2;

    if (!key) {
        return new Response();
    }

    const result = await s3Client.send(new GetObjectCommand({ Key: key, Bucket: env.S3_BUCKET }))

    if (!result.Body) {
        throw error(404, "image not found")
    }

    const array = await result.Body.transformToByteArray();
    const imageData = Array.from(array).map((color) => palette[color])

    const converted: Jimp = await new Promise((res) => {
        new Jimp(800 / divisions, 480 / divisions, (err, image) => {
            if (err) {
                throw error(500, err.message);
            }

            imageData.forEach((value, i) => {
                const [x, y] = byteIdx(i);
                image.setPixelColor(value, Math.floor(x / divisions), Math.floor(y / divisions));
            });

            res(image);
        })
    })

    const headers = new Headers();
    headers.append("content-type", 'image/png');
    headers.append("Cache-Control", "max-age=604800");
    const response = new Response(await converted.getBufferAsync('image/png'), { headers });

    return response;
};

