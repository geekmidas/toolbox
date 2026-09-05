import { defineProject } from 'vitest/config';

/**
 * This package had no config, so every suite in it was silently undiscovered —
 * five of them, including the driver registry and the Postgres cache whose
 * table handling is the difference between two caches in one database and one
 * cache read twice.
 *
 * The root config lists `projects: ['packages/*']`, which finds a package only
 * once it declares itself; a package without this file contributes no tests and
 * reports no failure for having none.
 */
export default defineProject({
	test: {
		name: 'cache',
		// The Upstash suite talks to the HTTP proxy, which talks to the Redis
		// behind it — both real, because a cache backend that behaves differently
		// under test is the one thing a cache test must not do.
		globalSetup: ['../testkit/test/cacheSetup.ts'],
	},
});
