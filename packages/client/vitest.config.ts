import { defineProject } from 'vitest/config';

/**
 * Names the project `client`. Without this file the package is still discovered —
 * the root config's `projects: ['packages/*']` falls back to the package name —
 * but only as `@geekmidas/client`, which is then what you have to type to filter
 * to it.
 */
export default defineProject({
	test: {
		name: 'client',
		/**
		 * This package is almost entirely types, and none of them were checked.
		 * `tsconfig.json` excludes `src/__tests__/**`, so every `expectTypeOf` in
		 * there compiled to nothing and passed for that reason — which is how the
		 * client came to demand the *parsed* type of a request body it had not
		 * sent yet, with type tests sitting right beside it.
		 *
		 * `*.test-d.ts` files are compiled and their type errors reported as
		 * failures, so an assertion about a type now fails when the type is wrong.
		 */
		typecheck: {
			enabled: true,
			include: ['src/**/*.test-d.ts'],
			tsconfig: './tsconfig.typecheck.json',
		},
	},
});
