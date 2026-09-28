/**
 * The test a request belongs to.
 *
 * A feature test drives an app the way it runs deployed: a browser calls the
 * API, the API calls the auth server, each over a URL. In a test those URLs are
 * served in-process, and every request made on behalf of one test has to reach
 * *that test's* transactions — its own call to the API, and the API's call to
 * the auth server made while handling it.
 *
 * The id travels two ways. In-process, an `AsyncLocalStorage` carries it
 * through every await a test and its handlers make. On the wire it is the
 * `x-test-context-id` header, which a stamped `fetch` adds to every request made
 * inside a context, so whatever serves the URL can find the context again —
 * without any caller, including code under test, writing the header.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** The header a test context travels in between client and server. */
export const TEST_CONTEXT_HEADER = 'x-test-context-id';

/**
 * Which side of a URL the running code is on.
 *
 * `client` is the test itself and the frontend it renders — what a browser
 * does. `server` is a handler serving a request. The difference matters for
 * cookies: a browser attaches its cookies to what it sends, a server forwards
 * only what it was handed. A server call that picked up the browser's cookies
 * would hide the bug of a server that forgets to forward them.
 */
export type TestSide = 'client' | 'server';

export interface TestContext {
	readonly id: string;
	readonly side: TestSide;
}

const storage = new AsyncLocalStorage<TestContext>();

/** The context the running code belongs to, if any. */
export function currentTestContext(): TestContext | undefined {
	return storage.getStore();
}

/** Run `fn` as the client side of the test `id`. */
export function runInTestContext<T>(id: string, fn: () => T): T {
	return storage.run({ id, side: 'client' }, fn);
}

/**
 * Run `fn` as a server handling a request for the test `id` — what whatever
 * serves a URL in-process wraps each request in.
 */
export function runAsServer<T>(id: string, fn: () => T): T {
	return storage.run({ id, side: 'server' }, fn);
}

/** The test a request was made for, read off its header. */
export function testContextOf(request: Request): string | undefined {
	return request.headers.get(TEST_CONTEXT_HEADER) ?? undefined;
}

/** `fetch`, adding the current test's id to every request made inside one. */
export function stampedFetch(inner: typeof fetch): typeof fetch {
	return (input, init) => {
		const context = currentTestContext();
		if (!context) return inner(input, init);

		const request = new Request(input, init);
		if (!request.headers.has(TEST_CONTEXT_HEADER)) {
			request.headers.set(TEST_CONTEXT_HEADER, context.id);
		}
		return inner(request);
	};
}

/**
 * Stamp the global `fetch` with the current test's id.
 *
 * Install it after anything else that patches `fetch` — MSW's interceptor in
 * particular — so the stamp is added before the request is intercepted.
 * Returns what puts the previous `fetch` back.
 */
export function installContextFetch(): () => void {
	const previous = globalThis.fetch;
	globalThis.fetch = stampedFetch(previous);
	return () => {
		globalThis.fetch = previous;
	};
}
