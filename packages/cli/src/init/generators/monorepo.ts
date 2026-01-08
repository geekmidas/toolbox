import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';

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

	// Root package.json for monorepo
	const rootPackageJson = {
		name: options.name,
		version: '0.0.1',
		private: true,
		type: 'module',
		scripts: {
			dev: 'turbo dev',
			build: 'turbo build',
			test: 'turbo test',
			'test:once': 'turbo test:once',
			typecheck: 'turbo typecheck',
			lint: 'biome lint .',
			fmt: 'biome format . --write',
			'fmt:check': 'biome format .',
		},
		devDependencies: {
			'@biomejs/biome': '~1.9.4',
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
		$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
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

# IDE
.idea/
.vscode/
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
			declaration: true,
			declarationMap: true,
			composite: true,
		},
		exclude: ['node_modules', 'dist'],
	};

	return [
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
			path: '.gitignore',
			content: gitignore,
		},
	];
}
