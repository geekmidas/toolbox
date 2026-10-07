import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MINIO_URL } from '../../../testkit/test/ports';
import { createStorageClient, registerStorageDriver } from '../registry';
import { s3Driver } from '../s3Driver';
import { build } from '../s3Url';

/**
 * A bucket's credentials from its own URL, against the repo compose stack's
 * MinIO (started by the project's `globalSetup`), whose root key is
 * `geekmidas`/`geekmidas`.
 */
const AWS_ENV = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'AWS_SESSION_TOKEN',
	'AWS_PROFILE',
] as const;

const address = {
	bucket: 'geekmidas',
	region: 'us-east-1',
	endpoint: MINIO_URL,
	forcePathStyle: true,
};

/** Upload through a presigned PUT, then read it back through a presigned GET. */
async function roundTrip(url: string, key: string): Promise<string> {
	const storage = createStorageClient(url);
	const body = `hello from ${key}`;

	const put = await fetch(
		await storage.getUploadURL({
			path: key,
			contentType: 'text/plain',
			contentLength: body.length,
		}),
		{ method: 'PUT', body, headers: { 'content-type': 'text/plain' } },
	);
	expect(put.status).toBe(200);

	const get = await fetch(await storage.getDownloadURL({ path: key }));
	expect(get.status).toBe(200);
	return get.text();
}

describe('credentials in the bucket URL', () => {
	let saved: Partial<Record<(typeof AWS_ENV)[number], string>>;

	beforeEach(() => {
		registerStorageDriver(s3Driver);
		saved = {};
		for (const name of AWS_ENV) {
			saved[name] = process.env[name];
			delete process.env[name];
		}
	});

	afterEach(() => {
		for (const name of AWS_ENV) {
			if (saved[name] === undefined) delete process.env[name];
			else process.env[name] = saved[name];
		}
	});

	it('presigns and PUTs with the URL’s keys and no AWS_* set', async () => {
		const url = build({
			...address,
			accessKeyId: 'geekmidas',
			secretAccessKey: 'geekmidas',
		});
		expect(url).toContain('geekmidas:geekmidas@geekmidas');

		const text = await roundTrip(url, 'url-credentials/no-env.txt');
		expect(text).toBe('hello from url-credentials/no-env.txt');
	});

	it('uses the URL’s keys over the environment’s', async () => {
		process.env.AWS_ACCESS_KEY_ID = 'not-a-minio-user';
		process.env.AWS_SECRET_ACCESS_KEY = 'not-its-secret';

		const url = build({
			...address,
			accessKeyId: 'geekmidas',
			secretAccessKey: 'geekmidas',
		});

		const text = await roundTrip(url, 'url-credentials/over-env.txt');
		expect(text).toBe('hello from url-credentials/over-env.txt');
	});

	it('falls back to the environment when the URL has no keys', async () => {
		process.env.AWS_ACCESS_KEY_ID = 'geekmidas';
		process.env.AWS_SECRET_ACCESS_KEY = 'geekmidas';

		const text = await roundTrip(build(address), 'url-credentials/env.txt');
		expect(text).toBe('hello from url-credentials/env.txt');
	});

	it('signs with the environment’s keys when the URL has none', async () => {
		process.env.AWS_ACCESS_KEY_ID = 'not-a-minio-user';
		process.env.AWS_SECRET_ACCESS_KEY = 'not-its-secret';

		const storage = createStorageClient(build(address));
		const put = await fetch(
			await storage.getUploadURL({
				path: 'url-credentials/rejected.txt',
				contentType: 'text/plain',
				contentLength: 1,
			}),
			{ method: 'PUT', body: 'x', headers: { 'content-type': 'text/plain' } },
		);
		expect(put.status).toBe(403);
	});
});
