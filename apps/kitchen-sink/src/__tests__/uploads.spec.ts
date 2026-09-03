import { describe, expect, it } from 'vitest';
import { postJson } from './__helpers__/app.js';

interface Presigned {
	url: string;
}

const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Where this stage's file server answers.
 *
 * The same key the application reads. Composing one here from a bucket name
 * would be wrong the moment the stage suffix appears — the test stage's server
 * is `uploadsserver-test` over the bucket `uploads-test` — and the 403 case
 * below would then pass for the wrong reason, since a missing object and a
 * private one are refused identically.
 */
function served(path: string): string {
	const base = process.env.UPLOADS_SERVER_URL;

	if (!base) {
		throw new Error(
			'No UPLOADS_SERVER_URL. The file server declares it, so this means the ' +
				'suite is not running under `gkm test`.',
		);
	}

	return `${base.replace(/\/+$/, '')}/${path}`;
}

/**
 * The file server, against the object store it was declared over.
 *
 * MinIO here and S3 deployed, and the endpoint knows neither: the scheme in the
 * injected URL picks the driver. So these assertions are about two things at
 * once — that a presigned URL actually works, and that the `open` patterns on
 * the declaration became a real policy on the bucket rather than a document
 * asserted in a unit test.
 *
 * The `fetch` calls go to MinIO over the network on purpose. A presigned URL
 * that cannot be used is the failure worth catching, and it can only be caught
 * by using one.
 */
describe('presigned uploads', () => {
	it('signs a URL that accepts the bytes', async () => {
		const body = `hello from the suite ${unique()}`;
		const path = `brand/hello-${unique()}.txt`;

		const { status, body: signed } = await postJson<Presigned>('/uploads', {
			path,
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
	});

	it('serves a path the declaration opened, unsigned', async () => {
		// `open: ['brand/**']` on the construct. Anyone may read it, with no
		// signature — which is what makes it the right place for a logo and the
		// wrong place for an invoice.
		const body = `public ${unique()}`;
		const path = `brand/logo-${unique()}.txt`;

		const { body: signed } = await postJson<Presigned>('/uploads', {
			path,
			contentType: 'text/plain',
			contentLength: body.length,
		});

		await fetch(signed.url, {
			method: 'PUT',
			headers: { 'content-type': 'text/plain' },
			body,
		});

		// Through the *edge*, not the bucket. This is the shape the file server
		// has deployed — a domain serving objects — and locally it is a real
		// certificate from Caddy's own CA, which the suite trusts because
		// reconcile exported the root and pointed Node at it.
		const read = await fetch(served(path));

		expect(read.status).toBe(200);
		expect(await read.text()).toBe(body);
	});

	it('refuses a path the declaration did not open', async () => {
		// The other half, and the one that matters: everything not on the list
		// needs a signature. This is the bucket policy enforcing it, not the
		// client declining to ask.
		const body = `private ${unique()}`;
		const path = `invoices/${unique()}.txt`;

		const { body: signed } = await postJson<Presigned>('/uploads', {
			path,
			contentType: 'text/plain',
			contentLength: body.length,
		});

		await fetch(signed.url, {
			method: 'PUT',
			headers: { 'content-type': 'text/plain' },
			body,
		});

		const read = await fetch(served(path));

		expect(read.status).toBe(403);
	});

	it('answers on a host of its own, over TLS', () => {
		// Not a path under the object store, which is what it used to be. The
		// difference is the whole point: `https://<server>.<project>.localhost`
		// is the shape it has deployed, so a cookie domain, a CORS origin and a
		// signed reference all look here the way they will there.
		const url = new URL(served('brand/x.txt'));

		expect(url.protocol).toBe('https:');
		expect(url.hostname).toMatch(/^uploadsserver-test\..+\.localhost$/);
	});

	it('rejects an upload request that is not one', async () => {
		const { status } = await postJson('/uploads', {
			path: '',
			contentLength: -1,
		});

		expect(status).toBe(422);
	});
});
