import { defineProject } from 'vitest/config';

/**
 * Names the project `db`, and creates the database its suites connect to.
 *
 * Four of them exercise real Postgres behaviour — transactions, isolation
 * levels, RLS policies — which is what this repo tests against a live database
 * rather than a mock. The compose stack supplies it, in CI and locally alike:
 *
 *   docker compose up -d
 *
 * A package with no config of its own is still discovered; what this file adds
 * is the short name and that setup.
 */
export default defineProject({
	test: {
		name: 'db',
		globalSetup: ['../testkit/test/globalSetup.ts'],
	},
});
