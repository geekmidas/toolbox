import { CONSTRUCTS_GLOB, routesGlob } from '../constructs.js';
import { BIOME_SCHEMA } from '../dependencies.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';
import { stagesBlock } from './stages.js';

/**
 * Vitest config for a database-enabled app.
 *
 * On its own, it is the root config and carries gkm's setup: the test stage
 * reconciled and every construct migrated, however the suite starts. In a
 * workspace the root config carries it instead — once, so no project filter
 * can skip it and nothing runs it twice.
 */
const vitestConfigFor = (
	monorepo: boolean,
) => `import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite resolves tsconfig \`paths\` itself; no plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',${
			monorepo
				? ''
				: `
    // The test stage, reconciled and every database construct's migrations
    // applied, before any test runs — whether \`gkm test\` or plain
    // \`vitest\` started it.
    globalSetup: ['@geekmidas/cli/vitest'],`
		}
  },
});
`;

/**
 * Generate configuration files (gkm.config.ts, tsconfig.json, biome.json, turbo.json)
 */
export function generateConfigFiles(
	options: TemplateOptions,
	template: TemplateConfig,
): GeneratedFile[] {
	const { telescope, routesStructure } = options;
	const isServerless = template.name === 'serverless';
	const hasWorker = template.name === 'worker';
	const isFullstack = options.template === 'fullstack';

	const getRoutesGlob = () => routesGlob(routesStructure);

	// For fullstack template, generate workspace config at root
	// Single app config is still generated for non-fullstack monorepo setups
	if (isFullstack) {
		// Workspace config is generated in monorepo.ts for fullstack
		return generateSingleAppConfigFiles(options, template, {
			telescope,
			routesStructure,
			isServerless,
			hasWorker,
			getRoutesGlob,
		});
	}

	// Build gkm.config.ts for single-app
	let gkmConfig = `import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({${stagesBlock(options.stages)}${
		options.monorepo
			? ''
			: `
  // One glob, every kind. What reconcile reads to derive the containers this
  // app needs: a declared database is why a Postgres exists at all, so nothing
  // lists \`postgres\` anywhere.
  constructs: '${CONSTRUCTS_GLOB}',`
	}
  routes: '${getRoutesGlob()}',
  envParser: './src/config/env#envParser',
  logger: './src/config/logger#logger',`;

	if (isServerless || hasWorker) {
		gkmConfig += `
  functions: './src/functions/**/*.ts',`;
	}

	if (hasWorker) {
		gkmConfig += `
  crons: './src/crons/**/*.ts',
  subscribers: './src/subscribers/**/*.ts',`;
	}

	if (telescope) {
		gkmConfig += `
  telescope: {
    enabled: true,
    path: '/__telescope',
  },`;
	}

	// Always add openapi config: each surface's client is written to the
	// workspace root's `.gkm/client/`, imported as `@<name>/client/<surface>`
	gkmConfig += `
  openapi: {
    enabled: true,
  },`;

	gkmConfig += `
});
`;

	// Build tsconfig.json - extends root for monorepo, standalone for non-monorepo
	// Using noEmit: true since typecheck is done via turbo
	const tsConfig = options.monorepo
		? // This API is its own workspace root: gkm.config.ts is beside it.
			workspaceApiTsConfig(options.name, '.gkm/stages.d.ts')
		: {
				compilerOptions: {
					target: 'ES2022',
					module: 'NodeNext',
					moduleResolution: 'NodeNext',
					lib: ['ES2022'],
					strict: true,
					esModuleInterop: true,
					skipLibCheck: true,
					forceConsistentCasingInFileNames: true,
					resolveJsonModule: true,
					noEmit: true,
					allowImportingTsExtensions: true,
					// The monorepo and fullstack layouts already mapped this; a
					// single app did not, so every `~/…` import the templates write
					// — the api's `~/router.ts`, the worker's `~/constructs/worker.ts`
					// — resolved to nothing and the project failed on first build.
					paths: {
						'~/*': ['./src/*'],
					},
				},
				// The stage names gkm.config.ts declares, as types — named, because
				// a dot folder is never matched by a wildcard.
				include: ['src/**/*.ts', '.gkm/stages.d.ts'],
				exclude: ['node_modules', 'dist'],
			};

	// Skip biome.json and turbo.json for monorepo (they're at root)
	if (options.monorepo) {
		const files: GeneratedFile[] = [
			{
				path: 'gkm.config.ts',
				content: gkmConfig,
			},
			{
				path: 'tsconfig.json',
				content: `${JSON.stringify(tsConfig, null, 2)}\n`,
			},
		];

		if (options.constructs.database) {
			files.push({
				path: 'vitest.config.ts',
				content: vitestConfigFor(Boolean(options.monorepo)),
			});
		}

		return files;
	}

	// Build biome.json
	const biomeConfig = {
		$schema: BIOME_SCHEMA,
		vcs: {
			enabled: true,
			clientKind: 'git',
			useIgnoreFile: true,
		},
		// Biome 2 moved import sorting into the assist, and `files.ignore` into
		// negated `includes`: the 1.x keys make it refuse the whole config.
		assist: { actions: { source: { organizeImports: 'on' } } },
		formatter: {
			enabled: true,
			indentStyle: 'space',
			indentWidth: 2,
			lineWidth: 80,
		},
		javascript: {
			formatter: {
				quoteStyle: 'single',
				trailingCommas: 'all',
				semicolons: 'always',
				arrowParentheses: 'always',
			},
		},
		linter: {
			enabled: true,
			rules: {
				recommended: true,
				correctness: {
					noUnusedImports: 'error',
					noUnusedVariables: 'error',
				},
				style: {
					noNonNullAssertion: 'off',
				},
			},
		},
		// Tailwind v4's `@theme` and `@apply`, which the UI package's CSS uses.
		css: { parser: { tailwindDirectives: true } },
		files: {
			includes: [
				'**',
				'!**/node_modules',
				'!**/dist',
				'!**/.gkm',
				'!**/coverage',
			],
		},
	};

	// Build turbo.json
	const turboConfig = {
		$schema: 'https://turbo.build/schema.json',
		tasks: {
			build: {
				dependsOn: ['^build'],
				outputs: ['dist/**'],
			},
			dev: {
				cache: false,
				persistent: true,
			},
			test: {
				dependsOn: ['^build'],
				cache: false,
			},
			'test:once': {
				dependsOn: ['^build'],
				outputs: ['coverage/**'],
			},
			typecheck: {
				dependsOn: ['^build'],
				outputs: [],
			},
			lint: {
				outputs: [],
			},
			fmt: {
				outputs: [],
			},
		},
	};

	const files: GeneratedFile[] = [
		{
			path: 'gkm.config.ts',
			content: gkmConfig,
		},
		{
			path: 'tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{
			path: 'biome.json',
			content: `${JSON.stringify(biomeConfig, null, 2)}\n`,
		},
		{
			path: 'turbo.json',
			content: `${JSON.stringify(turboConfig, null, 2)}\n`,
		},
	];

	if (options.constructs.database) {
		files.push({
			path: 'vitest.config.ts',
			content: vitestConfigFor(Boolean(options.monorepo)),
		});
	}

	return files;
}

/**
 * Helper to generate config files for API app in fullstack template
 * (workspace config is at root, so no gkm.config.ts for app)
 */
interface ConfigHelperOptions {
	telescope: boolean;
	routesStructure: string;
	isServerless: boolean;
	hasWorker: boolean;
	getRoutesGlob: () => string;
}

/**
 * The tsconfig of an API inside a workspace.
 *
 * One definition for both ways of getting one — the fullstack template and
 * `--monorepo` — because the two copies had drifted: only one of them mapped
 * the root constructs, so in the other `@<name>/constructs/api.ts` fell through
 * to the `packages/` mapping and nothing could load the surface.
 */
function workspaceApiTsConfig(name: string, stageTypes: string) {
	return {
		extends: '../../tsconfig.json',
		compilerOptions: {
			noEmit: true,
			allowImportingTsExtensions: true,
			paths: {
				'~/*': ['./src/*'],
				// Before the wildcard below it: TypeScript takes the longest
				// matching prefix, so the constructs at the workspace root win
				// over `packages/constructs/src`, which is a different thing
				// with a colliding name.
				[`@${name}/constructs/*`]: ['../../constructs/*'],
				[`@${name}/*`]: ['../../packages/*/src'],
			},
		},
		// `.gkm/stages.d.ts`, generated beside gkm.config.ts, types stage names
		// from it; a dot folder is never matched by a wildcard, so it is named.
		include: ['src/**/*.ts', stageTypes],
		exclude: ['node_modules', 'dist'],
	};
}

function generateSingleAppConfigFiles(
	options: TemplateOptions,
	_template: TemplateConfig,
	_helpers: ConfigHelperOptions,
): GeneratedFile[] {
	// For fullstack, only generate tsconfig.json for the API app
	// The workspace gkm.config.ts is generated in monorepo.ts
	// Using noEmit: true since typecheck is done via turbo
	// The workspace's gkm.config.ts, and so its `.gkm/`, is at the root.
	const tsConfig = workspaceApiTsConfig(options.name, '../../.gkm/stages.d.ts');

	const files: GeneratedFile[] = [
		{
			path: 'tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
	];

	if (options.constructs.database) {
		files.push({
			path: 'vitest.config.ts',
			content: vitestConfigFor(Boolean(options.monorepo)),
		});
	}

	return files;
}
