import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';

/**
 * Generate configuration files (gkm.config.ts, tsconfig.json, biome.json, turbo.json)
 */
export function generateConfigFiles(
	options: TemplateOptions,
	template: TemplateConfig,
): GeneratedFile[] {
	const { telescope, studio, routesStructure } = options;
	const isServerless = template.name === 'serverless';
	const hasWorker = template.name === 'worker';
	const isFullstack = options.template === 'fullstack';

	// Get routes glob pattern based on structure
	const getRoutesGlob = () => {
		switch (routesStructure) {
			case 'centralized-endpoints':
				return './src/endpoints/**/*.ts';
			case 'centralized-routes':
				return './src/routes/**/*.ts';
			case 'domain-based':
				return './src/**/routes/*.ts';
		}
	};

	// For fullstack template, generate workspace config at root
	// Single app config is still generated for non-fullstack monorepo setups
	if (isFullstack) {
		// Workspace config is generated in monorepo.ts for fullstack
		return generateSingleAppConfigFiles(options, template, {
			telescope,
			studio,
			routesStructure,
			isServerless,
			hasWorker,
			getRoutesGlob,
		});
	}

	// Build gkm.config.ts for single-app
	let gkmConfig = `import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
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

	if (studio) {
		gkmConfig += `
  studio: './src/config/studio#studio',`;
	}

	// Always add openapi config (output path is fixed to .gkm/openapi.ts)
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
		? {
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
			}
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
				},
				include: ['src/**/*.ts'],
				exclude: ['node_modules', 'dist'],
			};

	// Skip biome.json and turbo.json for monorepo (they're at root)
	if (options.monorepo) {
		return [
			{
				path: 'gkm.config.ts',
				content: gkmConfig,
			},
			{
				path: 'tsconfig.json',
				content: `${JSON.stringify(tsConfig, null, 2)}\n`,
			},
		];
	}

	// Build biome.json
	const biomeConfig = {
		$schema: 'https://biomejs.dev/schemas/2.3.0/schema.json',
		vcs: {
			enabled: true,
			clientKind: 'git',
			useIgnoreFile: true,
		},
		organizeImports: {
			enabled: true,
		},
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
		files: {
			ignore: ['node_modules', 'dist', '.gkm', 'coverage'],
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

	return [
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
}

/**
 * Helper to generate config files for API app in fullstack template
 * (workspace config is at root, so no gkm.config.ts for app)
 */
interface ConfigHelperOptions {
	telescope: boolean;
	studio: boolean;
	routesStructure: string;
	isServerless: boolean;
	hasWorker: boolean;
	getRoutesGlob: () => string;
}

function generateSingleAppConfigFiles(
	options: TemplateOptions,
	_template: TemplateConfig,
	_helpers: ConfigHelperOptions,
): GeneratedFile[] {
	// For fullstack, only generate tsconfig.json for the API app
	// The workspace gkm.config.ts is generated in monorepo.ts
	// Using noEmit: true since typecheck is done via turbo
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

	return [
		{
			path: 'tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
	];
}
