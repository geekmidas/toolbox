import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvironmentParser } from '@geekmidas/envkit';
import { createStorageClient, registerStorageDriver } from '@geekmidas/storage';
import { s3Driver, s3Url } from '@geekmidas/storage/aws';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MINIO_URL } from '../../../../testkit/test/ports';
import { ProcessorGenerator } from '../ProcessorGenerator';
import { processorsDevRoute } from '../processorRoute';

/**
 * `gkm dev`'s half of a file server's processors: the `processors.ts` the
 * build writes beside the dev server's app, mounted on a Hono app as the dev
 * server mounts it, answering against the test stack's MinIO — under the
 * route the local edge rewrites each pattern onto.
 */
const run = randomBytes(4).toString('hex');
const BUCKET_URL = s3Url.build({
	bucket: 'geekmidas',
	region: 'us-east-1',
	endpoint: MINIO_URL,
	forcePathStyle: true,
	accessKeyId: 'geekmidas',
	secretAccessKey: 'geekmidas',
});

let dir: string;
let app: Hono;

beforeAll(async () => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-processor-dev-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
	writeFileSync(
		join(dir, 'storage.ts'),
		`import { FileServer } from '@geekmidas/constructs/file-server';
import { z } from 'zod';

export const media = new FileServer('Media', { open: ['${run}/open/**'] });

export const shouting = media
  .process('/shout/:times/*')
  .params(z.object({ times: z.enum(['1', '2']) }))
  .handle(async ({ params, object }) => ({
    body: new TextDecoder().decode(await object.bytes()).toUpperCase().repeat(Number(params.times)),
    contentType: 'text/plain',
  }));
`,
	);

	const generator = new ProcessorGenerator();
	const file = await generator.buildDev(
		join(dir, '.gkm', 'server'),
		await generator.load('storage.ts', dir),
	);

	registerStorageDriver(s3Driver);
	await createStorageClient(BUCKET_URL).upload(
		`${run}/open/hello.txt`,
		Buffer.from('hello'),
		'text/plain',
	);

	const { setupProcessors } = await import(file);
	app = new Hono();
	setupProcessors(app, new EnvironmentParser({ MEDIA_URL: BUCKET_URL }));
}, 120_000);

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('processors under gkm dev', () => {
	const base = processorsDevRoute('MediaServer');

	it('answer their patterns under the route the edge rewrites onto', async () => {
		const made = await app.request(`${base}/shout/2/${run}/open/hello.txt`);

		expect(made.status).toBe(200);
		expect(await made.text()).toBe('HELLOHELLO');
		expect(made.headers.get('content-type')).toBe('text/plain');
	});

	it('refuse a parameter the schema does not allow, and a private key', async () => {
		expect(
			(await app.request(`${base}/shout/9/${run}/open/hello.txt`)).status,
		).toBe(400);
		expect(
			(await app.request(`${base}/shout/1/${run}/private/hello.txt`)).status,
		).toBe(404);
	});

	it('answer nothing for a file server that has no processors here', async () => {
		expect(
			(await app.request(`${processorsDevRoute('Other')}/shout/1/x`)).status,
		).toBe(404);
	});
});
