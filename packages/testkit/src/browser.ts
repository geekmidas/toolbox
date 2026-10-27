/**
 * A browser, for tests: a `fetch` that keeps cookies the way a browser does.
 *
 * An app's real clients — its typed API client, better-auth's client — run on
 * whatever `fetch` they are given. Give them this one and a test signs in the
 * way a person does: the auth server's `Set-Cookie` lands in the jar, and every
 * later request to a URL the cookie belongs to carries it. The jar follows the
 * browser's rules (RFC 6265 — Domain, Path, Secure, Expires), so a cookie set
 * for the wrong domain is not sent, exactly as a browser would not send it.
 *
 * Extend it once per app with that app's clients:
 *
 * ```ts
 * export class Browser extends TestBrowser {
 *   readonly api = createApi({ baseURL: process.env.API_URL, fetch: this.fetch });
 * }
 * ```
 */

import { randomInt } from 'node:crypto';
import { CookieJar } from 'tough-cookie';
import { currentTestContext } from './context';

/** How many redirects `fetch` follows before giving up, as browsers do. */
const MAX_REDIRECTS = 20;

export interface BrowserOptions {
	/**
	 * The `fetch` requests go out on. Defaults to the global one at the time
	 * the browser is created — so a browser made inside a test goes through
	 * whatever the test installed (MSW, the context stamp) and never through
	 * itself once installed.
	 */
	fetch?: typeof fetch;
	/**
	 * The address this browser connects from. A fresh one by default, from a
	 * private range nothing routes to — see {@link Browser.address}.
	 */
	address?: string;
	/**
	 * The cookies it starts with — another browser's jar, to be the same
	 * person on another tab. A fresh jar by default.
	 */
	jar?: CookieJar;
	/**
	 * The address of the app's site on every subdomain,
	 * `https://*.test.shop.localhost:8443`, which {@link Browser.on} puts a
	 * tenant's slug into. A feature test passes it when the app declares one.
	 */
	site?: string;
	/**
	 * The page this browser is on: sent as `Origin` on every request that does
	 * not set its own, and what a relative {@link Browser.visit} resolves
	 * against. See {@link Browser.on}.
	 */
	origin?: string;
}

export class Browser {
	/** The cookies this browser holds. */
	readonly jar: CookieJar;

	/**
	 * The page this browser is on, sent as `Origin` — what a surface's CORS
	 * and an auth server's trusted origins check, and what a multi-tenant app
	 * reads its tenant from. None until {@link Browser.on} gives it one.
	 */
	readonly origin?: string;

	/**
	 * The address this browser connects from, sent as `x-forwarded-for` the way
	 * a proxy in front of the app adds it. Each browser is a different person on
	 * a different connection, so what an app keys by client — an auth server's
	 * rate limit — counts each on its own. Without it every browser was the same
	 * client, and concurrent tests queued on the same rate-limit row of each
	 * other's open transactions. A request that sets the header itself — a test
	 * that is several machines — keeps its own.
	 */
	readonly address: string;

	/**
	 * This browser's `fetch`: cookies from the jar on the way out, `Set-Cookie`
	 * into the jar on the way back, redirects followed hop by hop so each hop's
	 * cookies are kept.
	 *
	 * On the server side of a test — a handler serving a request — it is the
	 * plain `fetch`: a server forwards what it was handed and never reaches into
	 * a browser's jar.
	 */
	readonly fetch: typeof fetch;

	private readonly send: typeof fetch;
	private readonly site?: string;

	constructor(options: BrowserOptions = {}) {
		this.send = options.fetch ?? globalThis.fetch;
		this.address = options.address ?? privateAddress();
		this.jar = options.jar ?? new CookieJar();
		if (options.site) this.site = options.site;
		if (options.origin) this.origin = options.origin;
		this.fetch = (input, init) => {
			if (currentTestContext()?.side === 'server') {
				return this.send(input, init);
			}
			return this.start(new Request(input, init), init?.redirect);
		};
	}

	/**
	 * Open a URL the way clicking a link does: a GET, redirects followed. A
	 * path is opened on the page this browser is on.
	 */
	visit(url: string | URL): Promise<Response> {
		return this.fetch(
			this.origin ? new URL(url, this.origin).toString() : String(url),
		);
	}

	/**
	 * The same person on a tenant's host: this browser — its cookies, its
	 * address, its clients — on `https://<slug>.<domain>`, the app's site on
	 * every subdomain. Each request it makes says so in `Origin`, as a page on
	 * that host would, so a test signs in once and calls the app as two
	 * tenants:
	 *
	 * ```ts
	 * await browser.signIn();
	 * await browser.on('acme').api.post('/orders', { body });
	 * expect(await browser.on('globex').api.get('/orders')).toEqual([]);
	 * ```
	 */
	on(slug: string): this {
		if (!this.site) throw new NoWildcardSite(slug);
		if (!SLUG.test(slug)) throw new NotATenantSlug(slug);

		const origin = new URL(this.site.replace('*', slug)).origin;
		const Same = this.constructor as new (options: BrowserOptions) => this;
		return new Same({
			fetch: this.send,
			address: this.address,
			jar: this.jar,
			site: this.site,
			origin,
		});
	}

	/** The cookies this browser would send to `url`, as a header value. */
	cookieHeader(url: string | URL): Promise<string> {
		return this.jar.getCookieString(String(url));
	}

	/**
	 * Make this browser the global `fetch`, for code that uses the global one —
	 * an app's module-level clients. Returns what puts the previous one back.
	 */
	install(): () => void {
		const previous = globalThis.fetch;
		globalThis.fetch = this.fetch;
		return () => {
			globalThis.fetch = previous;
		};
	}

	/** Read the body once, so a redirect that keeps the method can send it again. */
	private async start(
		request: Request,
		redirect: RequestInit['redirect'],
	): Promise<Response> {
		const body =
			request.method === 'GET' || request.method === 'HEAD'
				? undefined
				: await request.arrayBuffer();
		const headers = new Headers(request.headers);
		if (!headers.has('x-forwarded-for')) {
			headers.set('x-forwarded-for', this.address);
		}
		if (this.origin && !headers.has('origin')) {
			headers.set('origin', this.origin);
		}
		return this.request(
			{ url: request.url, method: request.method, headers, body },
			redirect,
		);
	}

	private async request(
		request: Hop,
		redirect: RequestInit['redirect'],
		hops = 0,
	): Promise<Response> {
		const headers = new Headers(request.headers);
		const cookie = await this.jar.getCookieString(request.url);
		if (cookie) {
			const existing = headers.get('cookie');
			headers.set('cookie', existing ? `${existing}; ${cookie}` : cookie);
		}

		const response = await this.send(request.url, {
			method: request.method,
			headers,
			body: request.body,
			redirect: 'manual',
		});

		for (const set of response.headers.getSetCookie()) {
			// A cookie a browser would refuse — the wrong domain, Secure over
			// plain HTTP — is dropped silently, as a browser drops it.
			await this.jar.setCookie(set, request.url, { ignoreError: true });
		}

		const location = response.headers.get('location');
		if (
			redirect === 'manual' ||
			!location ||
			response.status < 300 ||
			response.status >= 400
		) {
			return response;
		}

		if (hops >= MAX_REDIRECTS) {
			throw new TooManyRedirects(request.url, MAX_REDIRECTS);
		}

		// 303, and 301/302 after a POST, continue as a GET without a body — what
		// every browser does, whatever the spec once said about 302.
		const keepsMethod =
			response.status === 307 ||
			response.status === 308 ||
			request.method === 'GET' ||
			request.method === 'HEAD';

		const url = new URL(location, request.url).toString();
		const next: Hop = keepsMethod
			? { ...request, url }
			: { url, method: 'GET', headers: withoutBody(request.headers) };

		return this.request(next, redirect, hops + 1);
	}
}

/** One request in a redirect chain, with its body already read. */
interface Hop {
	url: string;
	method: string;
	headers: Headers;
	body?: ArrayBuffer;
}

/** Headers for a request that no longer carries the body they described. */
function withoutBody(headers: Headers): Headers {
	const next = new Headers(headers);
	next.delete('content-type');
	next.delete('content-length');
	return next;
}

/** A redirect chain longer than any browser follows. */
export class TooManyRedirects extends Error {
	constructor(
		readonly url: string,
		readonly limit: number,
	) {
		super(
			`${url} redirected more than ${limit} times. A browser gives up here ` +
				`too — look for a redirect loop.`,
		);
		this.name = 'TooManyRedirects';
	}
}

/** One DNS label, as a tenant's slug is. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** `browser.on(slug)` in an app with no site on every subdomain. */
export class NoWildcardSite extends Error {
	constructor(readonly slug: string) {
		super(
			`browser.on('${slug}') puts a tenant's slug into the app's site on ` +
				`every subdomain, and this browser knows of none. Declare a ` +
				`StaticSite with subdomain: '*', or pass its address as \`site\`.`,
		);
		this.name = 'NoWildcardSite';
	}
}

/** `browser.on(slug)` with something no host can start with. */
export class NotATenantSlug extends Error {
	constructor(readonly slug: string) {
		super(
			`'${slug}' is not a tenant's slug: one DNS label of lowercase ` +
				`letters, digits and inner hyphens, such as 'acme'.`,
		);
		this.name = 'NotATenantSlug';
	}
}

/**
 * An address from 10.0.0.0/8, which nothing routes to. Random rather than
 * counted: test files run in separate workers that share no counter.
 */
function privateAddress(): string {
	const n = randomInt(1, 2 ** 24 - 1);
	return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}
