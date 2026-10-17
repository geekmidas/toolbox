import { randomUUID } from 'node:crypto';
import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { createStorageClient, registerStorageDriver } from '@geekmidas/storage';
import { s3Driver, s3Url } from '@geekmidas/storage/aws';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MINIO_URL } from '../../../../testkit/test/ports';
import {
	FileServer,
	NotOpen,
	ProcessorNotOnThisServer,
} from '../../file-server';
import { ObjectStorage } from '../../object-storage';
import { DERIVED_PREFIX } from '../Processor';
import { handleProcessorRequest } from '../runProcessor';

/**
 * Against the test stack's MinIO, which the project's `globalSetup` starts:
 * its `geekmidas` bucket, under a prefix of this run's own.
 */
const run = `processors-${randomUUID()}`;
const BUCKET_URL = s3Url.build({
	bucket: 'geekmidas',
	region: 'us-east-1',
	endpoint: MINIO_URL,
	forcePathStyle: true,
	accessKeyId: 'geekmidas',
	secretAccessKey: 'geekmidas',
});

const bucket = new ObjectStorage('Media');
const media = new FileServer('Media', {
	origin: bucket,
	open: [`${run}/open/**`],
});
const other = new FileServer('Other', { origin: bucket, open: ['**'] });

let calls = 0;
const thumbnails = media
	.process('/i/:width/*')
	.params(z.object({ width: z.enum(['64', '256']) }))
	.handle(async ({ params, object, key }) => {
		calls++;
		const bytes = await object.bytes();
		return {
			body: `${params.width}:${key}:${bytes.length}:${await object.contentType()}`,
			contentType: 'text/plain',
			cache: 'immutable',
		};
	});

let previews = 0;
const preview = media.process('/p/*').handle(async ({ object }) => {
	previews++;
	return {
		body: new Uint8Array([...(await object.bytes())].reverse()),
		contentType: 'application/octet-stream',
		cache: { maxAge: 120 },
	};
});

const envParser = new EnvironmentParser({
	MEDIA_URL: BUCKET_URL,
	MEDIA_SERVER_URL: 'https://media.example.com',
	OTHER_SERVER_URL: 'https://other.example.com',
});
const serviceDiscovery = ServiceDiscovery.getInstance(envParser);
const storage = () => createStorageClient(BUCKET_URL);

const get = (path: string, method = 'GET') =>
	handleProcessorRequest(
		[thumbnails, preview],
		{ method, path },
		{ serviceDiscovery },
	);
const text = (body: Uint8Array | string | undefined) =>
	typeof body === 'string' ? body : new TextDecoder().decode(body);

beforeAll(async () => {
	registerStorageDriver(s3Driver);
	await storage().upload(
		`${run}/open/cat.png`,
		Buffer.from('meow'),
		'image/png',
	);
	await storage().upload(
		`${run}/open/raw.bin`,
		Buffer.from('abc'),
		'application/octet-stream',
	);
	await storage().upload(
		`${run}/private/secret.png`,
		Buffer.from('shh'),
		'image/png',
	);
});

describe('a processor, against MinIO', () => {
	it('makes a derivative of an open object, and keeps an immutable one', async () => {
		const made = await get(`/i/256/${run}/open/cat.png`);

		expect(made?.status).toBe(200);
		expect(text(made?.body)).toBe(`256:${run}/open/cat.png:4:image/png`);
		expect(made?.headers).toMatchObject({
			'content-type': 'text/plain',
			'cache-control': 'public, max-age=31536000, immutable',
			'x-gkm-processor': 'made',
		});

		// Kept in the bucket, under the derived prefix, at the path it answers.
		const kept = await fetch(
			await storage().getDownloadURL({
				path: `${DERIVED_PREFIX}i/256/${run}/open/cat.png`,
			}),
		);
		expect(kept.status).toBe(200);
		expect(await kept.text()).toBe(text(made?.body));
	});

	it('answers a kept derivative without running the handler', async () => {
		await get(`/i/64/${run}/open/cat.png`);
		const before = calls;

		const again = await get(`/i/64/${run}/open/cat.png`);

		expect(calls).toBe(before);
		expect(again?.status).toBe(200);
		expect(again?.headers['x-gkm-processor']).toBe('kept');
		expect(again?.headers['cache-control']).toBe(
			'public, max-age=31536000, immutable',
		);
		expect(text(again?.body)).toBe(`64:${run}/open/cat.png:4:image/png`);
	});

	it('keeps nothing that could change, and caches it as long as it said', async () => {
		const first = await get(`/p/${run}/open/raw.bin`);
		const second = await get(`/p/${run}/open/raw.bin`);

		expect(previews).toBe(2);
		expect(text(second?.body)).toBe('cba');
		expect(first?.headers['cache-control']).toBe('public, max-age=120');
		expect(second?.headers['x-gkm-processor']).toBe('made');
	});

	it('refuses parameters outside its schema, briefly cached', async () => {
		const before = calls;
		const refused = await get(`/i/4097/${run}/open/cat.png`);

		expect(refused?.status).toBe(400);
		expect(refused?.headers['cache-control']).toBe('public, max-age=60');
		expect(calls).toBe(before);
	});

	it('serves nothing an unsigned read would not', async () => {
		const before = calls;

		expect((await get(`/i/64/${run}/private/secret.png`))?.status).toBe(404);
		// Nor a derivative, reached through the processor as a source.
		expect(
			(await get(`/i/64/${DERIVED_PREFIX}i/256/${run}/open/cat.png`))?.status,
		).toBe(404);
		expect(calls).toBe(before);
	});

	it('answers 404, briefly cached, for an object that is not there', async () => {
		const missing = await get(`/i/64/${run}/open/nope.png`);

		expect(missing?.status).toBe(404);
		expect(missing?.headers['cache-control']).toBe('public, max-age=60');
	});

	it('answers only GET and HEAD, and leaves other paths to the server', async () => {
		expect((await get(`/i/64/${run}/open/cat.png`, 'POST'))?.status).toBe(405);
		expect((await get(`/i/64/${run}/open/cat.png`, 'HEAD'))?.status).toBe(200);
		expect(await get(`/${run}/open/cat.png`)).toBeUndefined();
	});
});

describe('a processed URL', () => {
	const client = () => media.service.register({ envParser } as never);

	it("is the file server's address for the derivative", async () => {
		expect(
			(await client()).processedUrl(
				thumbnails,
				{ width: '256' },
				`${run}/open/a b.png`,
			),
		).toBe(`https://media.example.com/i/256/${run}/open/a%20b.png`);
	});

	it('is never minted for a private object, or by another server', async () => {
		const files = await client();
		expect(() =>
			files.processedUrl(thumbnails, { width: '64' }, `${run}/private/x.png`),
		).toThrow(NotOpen);

		const others = await other.service.register({ envParser } as never);
		expect(() =>
			others.processedUrl(thumbnails, { width: '64' }, 'a.png'),
		).toThrow(ProcessorNotOnThisServer);
	});
});

describe('a processor as a construct', () => {
	it('is run by its file server, and reaches its bucket', async () => {
		expect(thumbnails.owner).toBe('MediaServer');
		expect(thumbnails.constructs).toEqual(['Media']);
		expect(thumbnails.prefix).toBe('/i/');
		expect(await thumbnails.getEnvironment()).toEqual(['MEDIA_URL']);
	});

	it('names the native packages it needs installed', () => {
		const sharp = media
			.process('/s/*')
			.native(['sharp', '@napi-rs/canvas'])
			.handle(async () => ({ body: '', contentType: 'text/plain' }));

		expect(sharp.native).toEqual(['sharp', '@napi-rs/canvas']);
		expect(() => media.process('/s/*').native(['Not A Package'])).toThrow(
			'is not a package name',
		);
	});
});
