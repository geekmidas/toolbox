import { defineProject } from 'vitest/config';

/**
 * This package had no config until now, so every suite in it was silently
 * undiscovered — including four that exercise real Postgres behaviour
 * (transactions, isolation levels, RLS policies), which is exactly the kind of
 * thing the repo tests against a live database rather than a mock.
 *
 * The compose stack supplies that database, in CI and locally alike:
 *
 *   docker compose up -d
 */
export default defineProject({
	test: {
		name: 'db',
		// Creates the test database before the suites that connect to it.
		globalSetup: ['../testkit/test/globalSetup.ts'],
	},
});
