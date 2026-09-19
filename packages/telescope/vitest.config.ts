import { defineProject } from 'vitest/config';

/**
 * Names the project `telescope`. Without this file the package is still discovered —
 * the root config's `projects: ['packages/*']` falls back to the package name —
 * but only as `@geekmidas/telescope`, which is then what you have to type to filter
 * to it.
 */
export default defineProject({
	test: {
		name: 'telescope',
	},
});
