import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	Browser,
	NotATenantSlug,
	NoWildcardSite,
	TooManyRedirects,
} from '../browser';
import {
	runAsServer,
	runInTestContext,
	stampedFetch,
	TEST_CONTEXT_HEADER,
} from '../context';

/**
 * A real HTTP server, so what is checked is what goes over the wire: which
 * cookies a request carried, which headers, which method after a redirect.
 */
let server: Server;
let base: string;
const seen: {
	path: string;
	method: string;
	cookie?: string;
	context?: string;
	forwardedFor?: string;
	origin?: string;
	body: string;
}[] = [];

const read = (request: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = '';
		request.on('data', (chunk) => {
			body += chunk;
		});
		request.on('end', () => resolve(body));
	});

beforeAll(async () => {
	server = createServer(async (request, response) => {
		const url = new URL(request.url!, 'http://localhost');
		seen.push({
			path: url.pathname,
			method: request.method!,
			cookie: request.headers.cookie,
			context: request.headers[TEST_CONTEXT_HEADER] as string | undefined,
			forwardedFor: request.headers['x-forwarded-for'] as string | undefined,
			origin: request.headers.origin,
			body: await read(request),
		});

		switch (url.pathname) {
			case '/sign-in':
				response.writeHead(200, {
					'set-cookie': 'session=ada; Path=/; HttpOnly',
				});
				return response.end('ok');
			case '/verify':
				// What a magic link does: set the cookie, then send the user on.
				response.writeHead(302, {
					'set-cookie': 'session=ada; Path=/; HttpOnly',
					location: '/home',
				});
				return response.end();
			case '/post-redirect':
				response.writeHead(303, { location: '/home' });
				return response.end();
			case '/keep-method':
				response.writeHead(307, { location: '/echo' });
				return response.end();
			case '/loop':
				response.writeHead(302, { location: '/loop' });
				return response.end();
			default:
				response.writeHead(200);
				return response.end('home');
		}
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const last = () => seen[seen.length - 1]!;

describe('Browser', () => {
	it('keeps a cookie the server set, and sends it back', async () => {
		const browser = new Browser();

		await browser.fetch(`${base}/sign-in`);
		await browser.fetch(`${base}/profile`);

		expect(last().cookie).toBe('session=ada');
	});

	it('keeps each browser’s cookies to itself', async () => {
		const ada = new Browser();
		const bob = new Browser();

		await ada.fetch(`${base}/sign-in`);
		await bob.fetch(`${base}/profile`);

		expect(last().cookie).toBeUndefined();
	});

	it('connects from an address of its own, on every request', async () => {
		const ada = new Browser();
		const bob = new Browser();

		await ada.fetch(`${base}/profile`);
		const first = last().forwardedFor;
		await ada.fetch(`${base}/profile`);

		expect(first).toBe(ada.address);
		expect(first).toMatch(/^10\.\d+\.\d+\.\d+$/);
		expect(last().forwardedFor).toBe(first);

		// A different person, on a different connection.
		await bob.fetch(`${base}/profile`);
		expect(last().forwardedFor).toBe(bob.address);
		expect(bob.address).not.toBe(ada.address);
	});

	it('keeps its address across a redirect', async () => {
		const ada = new Browser({ address: '10.1.2.3' });

		await ada.fetch(`${base}/verify`);

		expect(seen.slice(-2).map(({ forwardedFor }) => forwardedFor)).toEqual([
			'10.1.2.3',
			'10.1.2.3',
		]);
	});

	it('keeps an address a request chose — a test that is several machines', async () => {
		const ada = new Browser();

		await ada.fetch(`${base}/profile`, {
			headers: { 'x-forwarded-for': '203.0.113.7' },
		});

		expect(last().forwardedFor).toBe('203.0.113.7');
	});

	it('does not send a host’s cookie to another host', async () => {
		const browser = new Browser();
		const other = base.replace('localhost', '127.0.0.1');

		await browser.fetch(`${base}/sign-in`);
		await browser.fetch(`${other}/profile`);

		expect(last().cookie).toBeUndefined();
	});

	it('follows a redirect like a click on a link, keeping its cookie', async () => {
		const browser = new Browser();

		const response = await browser.visit(`${base}/verify`);

		expect(await response.text()).toBe('home');
		expect(last()).toMatchObject({ path: '/home', method: 'GET' });
		expect(await browser.cookieHeader(base)).toBe('session=ada');
	});

	it('continues a POST answered with 303 as a GET without its body', async () => {
		const browser = new Browser();

		await browser.fetch(`${base}/post-redirect`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ a: 1 }),
		});

		expect(last()).toMatchObject({ path: '/home', method: 'GET', body: '' });
	});

	it('resends the method and body through a 307', async () => {
		const browser = new Browser();

		await browser.fetch(`${base}/keep-method`, {
			method: 'POST',
			body: 'payload',
		});

		expect(last()).toMatchObject({
			path: '/echo',
			method: 'POST',
			body: 'payload',
		});
	});

	it('hands back the redirect itself when asked to', async () => {
		const browser = new Browser();

		const response = await browser.fetch(`${base}/verify`, {
			redirect: 'manual',
		});

		expect(response.status).toBe(302);
		expect(await browser.cookieHeader(base)).toBe('session=ada');
	});

	it('gives up on a redirect loop', async () => {
		await expect(new Browser().visit(`${base}/loop`)).rejects.toBeInstanceOf(
			TooManyRedirects,
		);
	});

	it('never lends its cookies to a server-side call', async () => {
		const browser = new Browser();
		await browser.fetch(`${base}/sign-in`);

		// A handler serving a request forwards what it was handed; reaching into
		// the browser's jar would hide a server that forgets to.
		await runAsServer('t1', () => browser.fetch(`${base}/profile`));

		expect(last().cookie).toBeUndefined();
	});

	it('becomes the global fetch when installed, and steps back after', async () => {
		const original = globalThis.fetch;
		const browser = new Browser();
		const restore = browser.install();

		try {
			await fetch(`${base}/sign-in`);
			await fetch(`${base}/profile`);
			expect(last().cookie).toBe('session=ada');
		} finally {
			restore();
		}

		expect(globalThis.fetch).toBe(original);
	});
});

describe('Browser.on', () => {
	const site = 'https://*.test.shop.localhost:8443';

	/** A browser's clients, as the generated one has them. */
	class AppBrowser extends Browser {
		readonly api = {
			me: () => this.fetch(`${base}/profile`),
		};
	}

	it('says which tenant it is on in every request’s Origin', async () => {
		const browser = new Browser({ site });

		await browser.on('acme').fetch(`${base}/profile`);
		expect(last().origin).toBe('https://acme.test.shop.localhost:8443');

		await browser.on('globex').fetch(`${base}/profile`);
		expect(last().origin).toBe('https://globex.test.shop.localhost:8443');
	});

	it('is the same person on each tenant: one jar, one address', async () => {
		const browser = new Browser({ site });

		await browser.on('acme').fetch(`${base}/sign-in`);
		await browser.on('globex').fetch(`${base}/profile`);

		expect(last().cookie).toBe('session=ada');
		expect(last().forwardedFor).toBe(browser.address);
	});

	it('keeps the app’s clients, calling from the tenant’s host', async () => {
		const browser = new AppBrowser({ site });

		await browser.on('acme').api.me();

		expect(last().origin).toBe('https://acme.test.shop.localhost:8443');
	});

	it('sends no Origin of its own before it is on a tenant', async () => {
		await new Browser({ site }).fetch(`${base}/profile`);

		expect(last().origin).toBeUndefined();
	});

	it('keeps an Origin a request set itself', async () => {
		await new Browser({ site })
			.on('acme')
			.fetch(`${base}/profile`, { headers: { origin: 'https://other.test' } });

		expect(last().origin).toBe('https://other.test');
	});

	it('opens a path on the tenant’s host', async () => {
		const opened: string[] = [];
		const browser = new Browser({
			site,
			fetch: async (input) => {
				opened.push(String(input));
				return new Response('ok');
			},
		});

		await browser.on('acme').visit('/orders/42');

		expect(opened).toEqual(['https://acme.test.shop.localhost:8443/orders/42']);
	});

	it('refuses a tenant when the app has no site on every subdomain', () => {
		expect(() => new Browser().on('acme')).toThrow(NoWildcardSite);
	});

	it('refuses what is not one DNS label', () => {
		const browser = new Browser({ site });

		expect(() => browser.on('a.b')).toThrow(NotATenantSlug);
		expect(() => browser.on('Acme')).toThrow(NotATenantSlug);
	});
});

describe('stampedFetch', () => {
	const stamped = stampedFetch(globalThis.fetch);

	it('adds the test’s id inside a context', async () => {
		await runInTestContext('t1', () => stamped(`${base}/profile`));

		expect(last().context).toBe('t1');
	});

	it('adds nothing outside one', async () => {
		await stamped(`${base}/profile`);

		expect(last().context).toBeUndefined();
	});

	it('stamps a server-side call too, so the next hop finds the same test', async () => {
		await runAsServer('t2', () => stamped(`${base}/profile`));

		expect(last().context).toBe('t2');
	});
});
