import { defineProject } from 'vitest/config';

/**
 * Names the project `cache`, and starts what its suites talk to.
 *
 * A package with no config of its own is still discovered — the root config's
 * `projects: ['packages/*']` falls back to the package name — so what this file
 * adds is the short name and the setup, not the tests.
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
