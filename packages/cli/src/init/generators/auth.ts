import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { DEPENDENCY_VERSIONS } from '../dependencies.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * Generate auth app files for fullstack template
 * Uses better-auth with magic link authentication
 */
export function generateAuthAppFiles(
	options: TemplateOptions,
): GeneratedFile[] {
	if (!options.monorepo || options.template !== 'fullstack') {
		return [];
	}

	const packageName = `@${options.name}/auth`;
	const modelsPackage = `@${options.name}/models`;

	// package.json for auth app
	const packageJson = {
		name: packageName,
		version: '0.0.1',
		private: true,
		type: 'module',
		// Both halves are `gkm`'s: the entry is generated from the `BetterAuth`
		// construct, so there is no source here for `tsc` to build or check.
		scripts: {
			dev: 'gkm dev',
			build: 'gkm build',
			'db:migrate': 'gkm exec -- npx @better-auth/cli migrate',
			'db:generate': 'gkm exec -- npx @better-auth/cli generate',
		},
		// What the generated entry and the construct behind it load. The
		// container is built from this package, so it names them itself rather
		// than leaning on the workspace root's.
		dependencies: {
			[modelsPackage]: 'workspace:*',
			'@geekmidas/auth': GEEKMIDAS_VERSIONS['@geekmidas/auth'],
			'@geekmidas/constructs': GEEKMIDAS_VERSIONS['@geekmidas/constructs'],
			'@geekmidas/db': GEEKMIDAS_VERSIONS['@geekmidas/db'],
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@geekmidas/logger': GEEKMIDAS_VERSIONS['@geekmidas/logger'],
			'@hono/node-server': '~1.14.1',
			'better-auth': DEPENDENCY_VERSIONS['better-auth'],
			hono: DEPENDENCY_VERSIONS.hono,
			kysely: DEPENDENCY_VERSIONS.kysely,
			pg: DEPENDENCY_VERSIONS.pg,
		},
		devDependencies: {
			'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
			'@types/node': '~22.0.0',
			'@types/pg': '~8.23.1',
			tsx: '~4.20.0',
			typescript: '~5.8.2',
		},
	};

	// tsconfig.json for auth app
	const tsConfig = {
		extends: '../../tsconfig.json',
		compilerOptions: {
			noEmit: true,
			allowImportingTsExtensions: true,
			baseUrl: '.',
			paths: {
				'~/*': ['./src/*'],
				[`@${options.name}/*`]: ['../../packages/*/src'],
			},
		},
		include: ['src/**/*.ts'],
		exclude: ['node_modules', 'dist'],
	};

	// .gitignore for auth app
	const gitignore = `node_modules/
dist/
.env.local
*.log
`;

	return [
		{
			path: 'apps/auth/package.json',
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{
			path: 'apps/auth/tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		// No `src/`. The auth server used to be a hand-written Hono app here — a
		// `src/index.ts` that read PORT, split `BETTER_AUTH_TRUSTED_ORIGINS` into
		// a CORS list, and mounted `/api/auth/*` itself, beside a `src/auth.ts`
		// that built the Better Auth instance and a `src/config/env.ts` to feed
		// it. Every line of that is the `BetterAuth` construct's now: the origins
		// come from whatever declared an edge to it, and the build generates the
		// entry, because the routes are a wildcard that no glob can find.
		//
		// What is left is the package the container is built from.
		{
			path: 'apps/auth/.gitignore',
			content: gitignore,
		},
	];
}
