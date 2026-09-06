import { snifferContext } from '@geekmidas/constructs';
import { describe, expect, it } from 'vitest';
import { uploads } from '../constructs/storage.js';
import { harness, postJson } from './__helpers__/app.js';

interface Presigned {
	url: string;
}

const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The file server's own client, resolved the way a handler resolves it.
 *
 * Through the construct and its `envParser`, never through `process.env`. That
 * is not style: `Credentials` resolves from `globalThis.__gkm_credentials__` or
 * from a build-time decryption, and under SST a linked value arrives through
 * the link — so `process.env` is the one source that is *not* reliably
 * populated in all three places. A test reading it would pass here and fail
 * wherever the value came from somewhere else.
 *
 * It also puts `url()` under test rather than routing around it: the client
 * refuses to mint an unsigned address for a key no `open` pattern admits, and
 * that guarantee is worth exercising.
 */
let resolved: Promise<Awaited<ReturnType<typeof uploads.service.register>>>;

function client() {
	resolved ??= (async () => {
		// After the entry has loaded, not before. *Which drivers exist* is the
		// generated entry point's decision — that is what keeps an app that never
		// talks to S3 from resolving the SDK — so a client built at module scope
		// finds an empty registry and fails with `registered: []`. Booting first
		// is the same order a handler gets for free, and it is where the parser
		// comes from too.
		const { envParser } = await harness();

		return uploads.service.register({ envParser, context: snifferContext });
	})();

	return resolved;
}

/**
 * The file server, against the object store it was declared over.
 *
 * MinIO here and S3 deployed, and the endpoint knows neither: the scheme in the
 * injected URL picks the driver. So these assertions cover two things at once —
 * that a presigned URL actually works, and that the `open` patterns became a
 * real policy on the bucket rather than a document asserted in a unit test.
 *
 * The `fetch` calls go over the network on purpose. A presigned URL that cannot
 * be used is the failure worth catching, and it can only be caught by using one.
 */
describe('presigned uploads', () => {
	/** Presign, PUT the bytes, and hand back what was written. */
	async function upload(key: string, body: string): Promise<Presigned> {
		const { status, body: signed } = await postJson<Presigned>('/uploads', {
			path: key,
			contentType: 'text/plain',
			contentLength: body.length,
		});

		expect(status).toBe(200);

		const put = await fetch(signed.url, {
			method: 'PUT',
			headers: { 'content-type': 'text/plain' },
			body,
		});

		expect(put.status).toBe(200);

		return signed;
	}

	it('signs a URL that accepts the bytes', async () => {
		await upload(`brand/hello-${unique()}.txt`, `hello ${unique()}`);
	});

	it('serves a path the declaration opened, unsigned', async () => {
		// `open: ['brand/**']` on the construct. Anyone may read it with no
		// signature — which is what makes it the right place for a logo and the
		// wrong place for an invoice.
		//
		// Read through the *edge*, not the bucket: the shape the file server has
		// deployed, and locally a real certificate from Caddy's own CA that the
		// suite trusts because reconcile exported the root and pointed Node at it.
		const key = `brand/logo-${unique()}.txt`;
		const body = `public ${unique()}`;

		await upload(key, body);

		const read = await fetch((await client()).openUrl(key));

		expect(read.status).toBe(200);
		expect(await read.text()).toBe(body);
	});

	it('refuses a path the declaration did not open', async () => {
		// The half that matters: everything not on the list needs a signature.
		// This is the bucket policy enforcing it rather than the client declining
		// to ask — so the address is composed from an open one rather than
		// requested, because the client will not mint it (see below).
		const key = `invoices/${unique()}.txt`;

		await upload(key, `private ${unique()}`);

		const origin = new URL((await client()).openUrl('brand/probe.txt')).origin;
		const read = await fetch(`${origin}/${key}`);

		expect(read.status).toBe(403);
	});

	it('answers on a host of its own, over TLS', async () => {
		// Not a path under the object store, which is what it used to be. The
		// difference is the point: `https://<server>.<project>.localhost` is the
		// shape it has deployed, so a cookie domain, a CORS origin and a shared
		// reference all look here the way they will there.
		const url = new URL((await client()).openUrl('brand/probe.txt'));

		expect(url.protocol).toBe('https:');
		expect(url.hostname).toMatch(/^uploadsserver-test\..+\.localhost$/);
	});

	it('refuses to mint an unsigned address for a private key', async () => {
		// The client's own guard, which the compiler enforces too — but a
		// JavaScript caller gets no compiler, and an unsigned URL for a private
		// object is a leak rather than a mistake.
		const served = await client();

		expect(() => served.openUrl('invoices/7.pdf')).toThrow();
	});

	it('rejects an upload request that is not one', async () => {
		const { status } = await postJson('/uploads', {
			path: '',
			contentLength: -1,
		});

		expect(status).toBe(422);
	});
});
