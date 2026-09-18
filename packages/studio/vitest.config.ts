import { defineProject } from 'vitest/config';

/**
 * A package without a config is still discovered — the root config's
 * `projects: ['packages/*']` falls back to the package name — so this file is
 * here for the two things that fallback does not give:
 *
 * - a short project name, so `vitest --project studio` works rather than
 *   demanding the full `@geekmidas/studio`;
 * - the database these suites connect to. It was there only because some other
 *   package's config had started the container first, which is not a
 *   dependency worth having.
 */
export default defineProject({
	test: {
		name: 'studio',
		globalSetup: ['../testkit/test/globalSetup.ts'],
	},
});
