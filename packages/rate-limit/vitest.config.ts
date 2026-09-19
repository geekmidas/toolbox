import { defineProject } from 'vitest/config';

/**
 * Names the project `rate-limit`. Without this file the package is still discovered —
 * the root config's `projects: ['packages/*']` falls back to the package name —
 * but only as `@geekmidas/rate-limit`, which is then what you have to type to filter
 * to it.
 */
export default defineProject({
	test: {
		name: 'rate-limit',
	},
});
