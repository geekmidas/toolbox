import { snifferContext } from '@geekmidas/constructs';
import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';
import { uploads } from '@kitchen-sink/constructs/storage.js';
import { describe, expect } from 'vitest';
import { it } from '#test';

const unique = () => crypto.randomUUID();

/**
 * The file server's own client, resolved the way a handler resolves it:
 * through the construct, with the environment `gkm test` preloaded — never
 * `process.env`, the one source that is not populated everywhere a handler
 * runs. Importing `#test` has already registered the storage drivers the app's
 * entry registers, so the client resolves against a real registry.
 *
 * It also puts `url()` under test rather than routing around it: the client
 * refuses to mint an unsigned address for a key no `open` pattern admits.
 */
const client = () =>
	uploads.service.register({
		envParser: new EnvironmentParser({ ...process.env, ...Credentials }),
		context: snifferContext,
	});

/**
 * The file server, against the object store it was declared over — MinIO
 * here, S3 deployed, and the endpoint knows neither.
 *
 * The bytes go to MinIO directly: a presigned URL that cannot be used is the
 * failure worth catching, and it can only be caught by using one.
 */
describe('presigned uploads', () => {
	/** Presign through the API, then PUT the bytes to the URL it signed. */
	async function upload(
		api: Parameters<Parameters<typeof it>[1]>[0]['browser']['api'],
		key: string,
		body: string,
	) {
		const { url } = await api.post('/uploads', {
			body: {
				path: key,
				contentType: 'text/plain',
				contentLength: body.length,
			},
		});

		const put = await fetch(url, {
			method: 'PUT',
			headers: { 'content-type': 'text/plain' },
			body,
		});
		expect(put.status).toBe(200);
	}

	it('signs a URL that accepts the bytes', async ({ browser }) => {
		await upload(
			browser.api,
			`brand/hello-${unique()}.txt`,
			`hello ${unique()}`,
		);
	});

	it('serves a path the declaration opened, unsigned', async ({ browser }) => {
		// `open: ['brand/**']` on the construct: readable with no signature, and
		// read through the edge — the shape the file server has deployed.
		const key = `brand/logo-${unique()}.txt`;
		const body = `public ${unique()}`;
		await upload(browser.api, key, body);

		const read = await fetch((await client()).openUrl(key));

		expect(read.status).toBe(200);
		expect(await read.text()).toBe(body);
	});

	it('refuses a path the declaration did not open', async ({ browser }) => {
		// Everything not on the list needs a signature — the bucket policy
		// enforcing it, not the client declining to ask.
		const key = `invoices/${unique()}.txt`;
		await upload(browser.api, key, `private ${unique()}`);

		const origin = new URL((await client()).openUrl('brand/probe.txt')).origin;
		const read = await fetch(`${origin}/${key}`);

		expect(read.status).toBe(403);
	});

	it('answers on a host of its own, over TLS', async () => {
		const url = new URL((await client()).openUrl('brand/probe.txt'));

		expect(url.protocol).toBe('https:');
		expect(url.hostname).toMatch(/^uploadsserver-test\..+\.localhost$/);
	});

	it('refuses to mint an unsigned address for a private key', async () => {
		const served = await client();

		expect(() => served.openUrl('invoices/7.pdf')).toThrow();
	});

	it('rejects an upload request that is not one', async ({ browser }) => {
		await expect(
			browser.api.post('/uploads', {
				body: { path: '', contentType: 'text/plain', contentLength: -1 },
			}),
		).rejects.toMatchObject({ status: 422 });
	});
});
