import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * Generate monorepo root files (pnpm-workspace.yaml, root package.json, etc.)
 */
export function generateMonorepoFiles(
	options: TemplateOptions,
	_template: TemplateConfig,
): GeneratedFile[] {
	if (!options.monorepo) {
		return [];
	}

	const isFullstack = options.template === 'fullstack';

	// Root package.json for monorepo
	const rootPackageJson = {
		name: options.name,
		version: '0.0.1',
		private: true,
		type: 'module',
		packageManager: 'pnpm@10.13.1',
		scripts: {
			dev: isFullstack ? 'gkm dev' : 'turbo dev',
			build: isFullstack ? 'gkm build' : 'turbo build',
			test: isFullstack ? 'gkm test' : 'turbo test',
			'test:once': isFullstack ? 'gkm test --run' : 'turbo test:once',
			typecheck: 'turbo typecheck',
			lint: 'biome lint .',
			fmt: 'biome format . --write',
			'fmt:check': 'biome format .',
			...(options.deployTarget === 'dokploy'
				? { deploy: 'gkm deploy --provider dokploy --stage production' }
				: {}),
		},
		dependencies: {
			zod: '~4.1.0',
		},
		devDependencies: {
			'@biomejs/biome': '~2.3.0',
			'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
			esbuild: '~0.27.0',
			turbo: '~2.3.0',
			typescript: '~5.8.2',
			vitest: '~4.0.0',
		},
	};

	// pnpm-workspace.yaml - detect folder structure from apiPath
	const apiPathParts = options.apiPath.split('/');
	const appsFolder = apiPathParts[0] || 'apps';

	const pnpmWorkspace = `packages:
  - '${appsFolder}/*'
  - 'packages/*'
`;

	// Root biome.json
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

	// Root turbo.json
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

	// Root .gitignore
	const gitignore = `# Dependencies
node_modules/

# Build output
dist/
.gkm/

# Environment
.env
.env.local
.env.*.local
docker/.env

# IDE
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# Test coverage
coverage/

# TypeScript cache
*.tsbuildinfo

# Turbo
.turbo/
`;

	// Root tsconfig.json - base config for all packages
	// Using turbo typecheck to run tsc --noEmit in each app/package
	const tsConfig = {
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
		},
		exclude: ['node_modules', 'dist'],
	};

	// Vitest config for workspace
	const vitestConfig = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/**/*.{test,spec}.ts', 'packages/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
    },
  },
});
`;

	// VSCode settings for consistent development experience
	const vscodeSettings = {
		'search.exclude': {
			'**/.sst': true,
			'**/.gkm': true,
			'**/.turbo': true,
		},
		'editor.formatOnSave': true,
		'editor.defaultFormatter': 'biomejs.biome',
		'editor.codeActionsOnSave': {
			'source.fixAll.biome': 'always',
			'source.organizeImports.biome': 'always',
			'source.organizeImports': 'always',
		},
		'[typescriptreact]': {
			'editor.defaultFormatter': 'biomejs.biome',
		},
		'[typescript]': {
			'editor.defaultFormatter': 'biomejs.biome',
		},
		'[javascript]': {
			'editor.defaultFormatter': 'biomejs.biome',
		},
		'[json]': {
			'editor.defaultFormatter': 'biomejs.biome',
		},
		'cSpell.words': [
			'betterauth',
			'dokploy',
			'envkit',
			'geekmidas',
			'healthcheck',
			'kysely',
			'testkit',
			'timestamptz',
			'turborepo',
			options.name,
		],
	};

	// VSCode extensions recommendations
	const vscodeExtensions = {
		recommendations: [
			'biomejs.biome',
			'streetsidesoftware.code-spell-checker',
			'dbaeumer.vscode-eslint',
			'ms-azuretools.vscode-docker',
		],
	};

	const files: GeneratedFile[] = [
		{
			path: 'package.json',
			content: `${JSON.stringify(rootPackageJson, null, 2)}\n`,
		},
		{
			path: 'pnpm-workspace.yaml',
			content: pnpmWorkspace,
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
		{
			path: 'vitest.config.ts',
			content: vitestConfig,
		},
		{
			path: '.gitignore',
			content: gitignore,
		},
		{
			path: '.vscode/settings.json',
			content: `${JSON.stringify(vscodeSettings, null, '\t')}\n`,
		},
		{
			path: '.vscode/extensions.json',
			content: `${JSON.stringify(vscodeExtensions, null, '\t')}\n`,
		},
	];

	// Add workspace config for fullstack template
	if (isFullstack) {
		files.push({
			path: 'gkm.config.ts',
			content: generateWorkspaceConfig(options),
		});
	}

	return files;
}

/**
 * Generate gkm.config.ts with defineWorkspace for fullstack template
 */
function generateWorkspaceConfig(options: TemplateOptions): string {
	const { telescope, services, deployTarget, routesStructure } = options;

	// Get routes glob pattern
	const getRoutesGlob = (): string => {
		switch (routesStructure) {
			case 'centralized-endpoints':
				return './src/endpoints/**/*.ts';
			case 'centralized-routes':
				return './src/routes/**/*.ts';
			case 'domain-based':
				return './src/**/routes/*.ts';
		}
	};

	let config = `import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: '${options.name}',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: '${getRoutesGlob()}',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',`;

	if (telescope) {
		config += `
      telescope: {
        enabled: true,
        path: '/__telescope',
      },`;
	}

	config += `
      openapi: {
        enabled: true,
      },
    },
    auth: {
      type: 'backend',
      path: 'apps/auth',
      port: 3002,
      entry: './src/index.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
    web: {
      type: 'frontend',
      framework: 'nextjs',
      path: 'apps/web',
      port: 3001,
      dependencies: ['api', 'auth'],
      client: {
        output: './src/api',
      },
    },
  },
  shared: {
    packages: ['packages/*'],
    models: {
      path: 'packages/models',
      schema: 'zod',
    },
  },`;

	// Add services if any are selected
	if (services.db || services.cache || services.mail) {
		config += `
  services: {`;
		if (services.db) {
			config += `
    db: true,`;
		}
		if (services.cache) {
			config += `
    cache: true,`;
		}
		if (services.mail) {
			config += `
    mail: true,`;
		}
		config += `
  },`;
	}

	// Add deploy config if dokploy is selected
	if (deployTarget === 'dokploy') {
		config += `
  deploy: {
    default: 'dokploy',
  },`;
	}

	config += `
});
`;

	return config;
}
