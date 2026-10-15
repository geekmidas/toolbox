import { dirname } from 'node:path';
import {
	cacheFor,
	storageFor,
	workspaceConstructsGlobs,
} from '../constructs.js';
import {
	BIOME_SCHEMA,
	DEPENDENCY_VERSIONS,
	PNPM_VERSION,
	TOOLCHAIN_VERSIONS,
} from '../dependencies.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';
import { deployPackage, generateDeployFiles } from './deploy.js';
import { workspaceReact, workspaceReactTypes } from './react.js';
import {
	accessControlMigration,
	accessControlSeeds,
	apiConstruct,
	authConstruct,
	databaseConstruct,
	emailConstruct,
	emailLayout,
	magicLinkTemplate,
	workspaceUsersMigration,
} from './root-constructs.js';
import { stagesBlock } from './stages.js';

/**
 * What the root `constructs/` folder imports, and the peers each construct
 * needs, for the services this workspace was scaffolded with.
 */
function rootConstructDependencies(
	options: TemplateOptions,
): Record<string, string> {
	const v = GEEKMIDAS_VERSIONS;
	return {
		'@geekmidas/constructs': v['@geekmidas/constructs'],
		'@geekmidas/logger': v['@geekmidas/logger'],
		...(options.loggerType === 'pino'
			? { pino: DEPENDENCY_VERSIONS.pino }
			: {}),
		// `RestApi` needs Telescope's types; `BetterAuth` needs the auth
		// package and Better Auth itself.
		'@geekmidas/telescope': v['@geekmidas/telescope'],
		'@geekmidas/auth': v['@geekmidas/auth'],
		'better-auth': DEPENDENCY_VERSIONS['better-auth'],
		// `KyselyDatabase`.
		'@geekmidas/db': v['@geekmidas/db'],
		kysely: DEPENDENCY_VERSIONS.kysely,
		pg: DEPENDENCY_VERSIONS.pg,
		...(options.constructs.uploads
			? {
					'@geekmidas/storage': v['@geekmidas/storage'],
					'@aws-sdk/client-s3': DEPENDENCY_VERSIONS['@aws-sdk/client-s3'],
					'@aws-sdk/s3-presigned-post':
						DEPENDENCY_VERSIONS['@aws-sdk/s3-presigned-post'],
					'@aws-sdk/s3-request-presigner':
						DEPENDENCY_VERSIONS['@aws-sdk/s3-request-presigner'],
				}
			: {}),
		...(options.constructs.mail
			? { '@geekmidas/emailkit': v['@geekmidas/emailkit'] }
			: {}),
		...(options.constructs.cache
			? { '@geekmidas/cache': v['@geekmidas/cache'] }
			: {}),
		// The auth server's plugins, shared with every frontend's hooks.
		[`@${options.name}/auth`]: 'workspace:*',
		// What the seeds and scripts at the root read: the permission catalogue
		// and the system roles.
		[`@${options.name}/models`]: 'workspace:*',
		// The mailer's templates are React Email components, rendered on the
		// auth server.
		'@react-email/components': DEPENDENCY_VERSIONS['@react-email/components'],
		// …and typed against the workspace's React.
		'@types/react': workspaceReactTypes(options),
		// A mobile app signs in through Better Auth's Expo plugin, which the
		// auth server loads when one depends on it.
		...(options.mobileApp
			? { '@better-auth/expo': DEPENDENCY_VERSIONS['better-auth'] }
			: {}),
	};
}

/**
 * What each API's generated client imports, installed where the client is.
 *
 * The client is written to the root's `.gkm/client/`, so it resolves
 * `@geekmidas/client` and React Query from the root `node_modules` — as the
 * root `constructs/` folder does its imports — not from whichever site imports
 * it.
 *
 * React is pinned here too, because React Query's hooks resolve it from the
 * root, and a frontend running a different React than the one its client's
 * hooks resolve loads two — a broken hook call. So the root's React is the
 * workspace's: every frontend that imports a client runs this one. It starts
 * as the scaffolded frontend's; a frontend added later — a web app beside an
 * Expo app — is kept on the same version, not given its own.
 */
function rootClientDependencies(
	options: TemplateOptions,
): Record<string, string> {
	return {
		'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
		'@tanstack/react-query': DEPENDENCY_VERSIONS['@tanstack/react-query'],
		react: workspaceReact(options),
	};
}

/**
 * What `test/factories/` imports at the root: the factory and faker, and
 * Kysely's types where the root does not already install it for the
 * constructs.
 */
function rootFactoryDependencies(
	options: TemplateOptions,
): Record<string, string> {
	return {
		'@geekmidas/testkit': GEEKMIDAS_VERSIONS['@geekmidas/testkit'],
		'@faker-js/faker': DEPENDENCY_VERSIONS['@faker-js/faker'],
		...(options.template === 'fullstack'
			? {}
			: { kysely: DEPENDENCY_VERSIONS.kysely }),
	};
}

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
	const deploy = deployPackage(options);
	const isSst = options.deployTarget === 'sst';

	// Root package.json for monorepo
	const rootPackageJson = {
		name: options.name,
		version: '0.0.1',
		private: true,
		type: 'module',
		packageManager: PNPM_VERSION,
		scripts: {
			dev: isFullstack ? 'gkm dev' : 'turbo dev',
			build: isFullstack ? 'gkm build' : 'turbo build',
			test: isFullstack ? 'gkm test' : 'turbo test',
			'test:once': isFullstack ? 'gkm test --run' : 'turbo test:once',
			typecheck: 'turbo typecheck',
			lint: 'biome lint .',
			fmt: 'biome format . --write',
			'fmt:check': 'biome format .',
			...deploy.scripts,
		},
		dependencies: {
			zod: DEPENDENCY_VERSIONS.zod,
			// The root `constructs/` folder resolves its imports from the root
			// `node_modules`, not from any app's — so what the constructs load,
			// and the peers each of them needs, are installed here.
			...(isFullstack ? rootConstructDependencies(options) : {}),
			...(isFullstack ? rootClientDependencies(options) : {}),
			...deploy.dependencies,
		},
		devDependencies: {
			'@biomejs/biome': DEPENDENCY_VERSIONS['@biomejs/biome'],
			'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
			esbuild: TOOLCHAIN_VERSIONS['esbuild'],
			tsx: TOOLCHAIN_VERSIONS['tsx'],
			turbo: DEPENDENCY_VERSIONS['turbo'],
			typescript: TOOLCHAIN_VERSIONS['typescript'],
			vitest: TOOLCHAIN_VERSIONS['vitest'],
			// The test factories live at the root — a factory belongs to a
			// database, not to an app — and resolve their imports from the root
			// `node_modules`, as the constructs do.
			...(options.constructs.database ? rootFactoryDependencies(options) : {}),
			...deploy.devDependencies,
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
		// NativeWind is Tailwind v3, whose `@tailwind` directives Biome's CSS
		// linter does not know.
		...(options.mobileApp
			? {
					overrides: [
						{
							includes: ['apps/app/global.css'],
							linter: {
								rules: { suspicious: { noUnknownAtRules: 'off' } },
							},
						},
					],
				}
			: {}),
		files: {
			includes: [
				'**',
				'!**/node_modules',
				'!**/dist',
				'!**/.gkm',
				'!**/coverage',
				...(isSst ? ['!**/.sst', '!sst-env.d.ts'] : []),
			],
		},
	};

	// Root turbo.json
	const turboConfig = {
		$schema: 'https://turbo.build/schema.json',
		tasks: {
			build: {
				dependsOn: ['^build'],
				// Turbo hashes a package's own files, and an app's constructs and
				// the config naming them live above it, at the root. Without these,
				// editing a construct replays a stale cached build. Root task config
				// applies to every package, so a new app is covered with nothing
				// generated. `$TURBO_ROOT$` needs turbo 2.4+.
				inputs: [
					'$TURBO_DEFAULT$',
					'$TURBO_ROOT$/constructs/**/*.ts',
					'$TURBO_ROOT$/gkm.config.ts',
				],
				// A backend's build is under `.gkm/`; a Next.js site's under `.next/`.
				outputs: ['dist/**', '.gkm/**', '.next/**', '!.next/cache/**'],
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

# Written by gkm from the constructs; your own docker-compose.yml is not
docker-compose.constructs.yml

# Environment
.env
.env.local
.env.*.local

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
${isSst ? '\n# SST\n.sst/\n' : ''}`;

	// Root tsconfig.json - base config for all packages
	// Using turbo typecheck to run tsc --noEmit in each app/package
	const tsConfig = {
		compilerOptions: {
			// How an app reaches the workspace's constructs without climbing out
			// of its own directory with `../../` — and the manifest `gkm build`
			// writes at the root, for whatever reads what was built.
			paths: {
				...(isFullstack
					? { [`@${options.name}/constructs/*`]: ['./constructs/*'] }
					: {}),
				[`@${options.name}/manifest`]: [
					`./.gkm/manifest/${isSst ? 'aws' : 'server'}.ts`,
				],
				// Each API's typed client, generated beside the manifest.
				[`@${options.name}/client/*`]: ['./.gkm/client/*'],
			},
			...(isFullstack
				? {
						// The constructs import each other with `.ts` extensions.
						allowImportingTsExtensions: true,
						noEmit: true,
						// The mailer's templates are React components
						// (`constructs/templates/`), compiled by every app that imports
						// the constructs. A site overrides it with its own.
						jsx: 'react-jsx',
					}
				: {}),
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
		// Everything, as when nothing is listed, plus the stage names
		// gkm.config.ts declares — \`.gkm/stages.d.ts\`, named because a dot
		// folder is never matched by a wildcard.
		include: ['**/*', '.gkm/stages.d.ts'],
		// SST typechecks its own config against its own platform types, which
		// exist only after \`sst install\` and are not this project's to check.
		exclude: [
			'node_modules',
			'dist',
			...(isSst ? ['sst.config.ts', '.sst'] : []),
		],
	};

	// Vitest config for workspace
	const vitestConfig = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The test stage, reconciled and every database construct's migrations
    // applied, before any project's tests start — declared here, once, so no
    // project filter can skip it and nothing runs it twice.
    globalSetup: ['@geekmidas/cli/vitest'],
    // Each app and package is its own project, so its own config — its path
    // aliases — applies to its own tests.
    projects: ['apps/*', 'packages/*'],
    // The shared packages ship without tests of their own.
    passWithNoTests: true,
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
		...generateDeployFiles(options),
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
 * `gkm.config.ts` for the fullstack workspace.
 *
 * What is *not* here is the point. There is no `apps` block: the apps are the
 * constructs that said they have a process — a `RestApi`, a `BetterAuth`, a
 * `StaticSite` — and naming them again here would be the same sentence written
 * twice with only one copy checked.
 *
 * There is no `services` block either unless something non-default was picked.
 * Every key defaults from the deploy target: on a server target a cache is a
 * table in the database that is already there, storage is MinIO, mail is SES.
 */
function generateWorkspaceConfig(options: TemplateOptions): string {
	const config = `import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  // The scope every physical name is built from: \`Database\` becomes
  // \`production-${options.name}-database\` on Dokploy and on AWS alike.
  name: '${options.name}',
${stagesBlock(options.stages)}
${deployBlock(options)}
  // Every kind, in every app. A declared database is why a Postgres exists, a
  // declared bucket is why MinIO does, a declared topic is why a broker does —
  // none of it listed here. It is also where the apps come from: a
  // \`StaticSite\` is an app, and so is every \`RestApi\`. And it finds each
  // app's endpoints, crons and subscribers: an endpoint belongs to the surface
  // it was built from, not to the directory it sits in.
  constructs: [
${workspaceConstructsGlobs(options.routesStructure, dirname(options.apiPath))
	.map((glob) => `    '${glob}',`)
	.join('\n')}
  ],

${stateBlock(options)}  secrets: {
    enabled: true,${secretsStore(options)}
  },
});
`;

	return config;
}

/**
 * Where it deploys, when that is not the default Dokploy: what a bare
 * `gkm build` builds for, and which backends a cache or a broker resolves to.
 */
function deployBlock(options: TemplateOptions): string {
	if (options.deployTarget === 'compose') {
		// A stage named like an identifier is a bare key, as a person writes it.
		const key = (stage: string) =>
			/^[A-Za-z_$][\w$]*$/.test(stage) ? stage : `'${stage}'`;
		const servers = options.stages.deployed
			.map((stage) => `${key(stage)}: { user: 'deploy' }`)
			.join(', ');
		return `
  // \`gkm compose --stage <stage>\` runs a stage as one Docker Compose stack:
  // the local stage on this machine, a deployed stage on its server, whose
  // Docker it drives over SSH. CI builds every image and pushes it here, and
  // the server runs exactly those. On ghcr.io the owner is the repository's —
  // the user or organisation whose packages the workflow's token can write.
  deploy: {
    default: 'compose',
    registry: '${options.registry}',
    // Each deployed stage's server: the SSH user, in its docker group. The
    // host is the stage's GKM_SERVER_IPV4 secret unless \`host\` is set.
    compose: { server: { ${servers} } },
  },
`;
	}
	if (options.deployTarget !== 'sst') return '';
	return `
  // \`gkm deploy\` runs \`sst deploy\` on the manifest \`gkm build\` writes to
  // \`.gkm/manifest/aws.ts\`. Each construct becomes a managed AWS resource.
  deploy: { default: 'sst' },
`;
}

/**
 * Where a deployed stage's deploy state lives: on AWS, the project bucket —
 * one bucket per project and account, created by the first deploy — which
 * the stage's secrets share.
 */
function stateBlock(options: TemplateOptions): string {
	if (options.deployTarget !== 'sst' || !options.region) return '';
	return `  // Deploy state, secrets and backups share one bucket per project and
  // account, gkm-<project>-<account id>, created by the first deploy:
  // versioned, encrypted, never public.
  state: { provider: 's3', region: '${options.region}' },

`;
}

/**
 * Where a deployed stage's secrets live. On AWS that is the project bucket,
 * beside the deploy state, in the stage's own account, which the deploy job
 * reaches with the role it already assumed; a server target keeps the
 * encrypted local file, the default.
 */
function secretsStore(options: TemplateOptions): string {
	if (options.deployTarget !== 'sst' || !options.region) return '';
	return `
    // Deployed stages keep their secrets in the project bucket, beside the
    // state, in the account each stage deploys to:
    // \`gkm secrets:set <KEY> '…' --stage <stage>\` writes there.
    store: { provider: 's3' },`;
}

/**
 * The workspace's constructs, at its root rather than inside an app.
 *
 * They outlive the app that used them first: a site depending on the API is a
 * fact about the workspace, and a construct reaching across into a sibling
 * app's `src/` to state it is the shape this layout removes. Apps import them
 * through the `@<name>/constructs/*` path the root tsconfig maps.
 *
 * Every one of these is also an answer config used to give: the database is
 * why a Postgres exists, the surface and the site are the apps, and the edges
 * between them are the CORS origins and the build order.
 */
export function generateRootConstructs(
	options: TemplateOptions,
): GeneratedFile[] {
	if (!options.monorepo || options.template !== 'fullstack') return [];

	const { cache, uploads } = options.constructs;
	const files: GeneratedFile[] = [
		{
			path: 'constructs/logger.ts',
			content: `import { createLogger } from '@geekmidas/logger/${options.loggerType}';

/**
 * The logger every endpoint runs with.
 *
 * Named once, here, because the surface carries it — the actual logger, not
 * a module path the build prints into each handler.
 */
export const logger = createLogger();
`,
		},
		{ path: 'constructs/database.ts', content: databaseConstruct(options) },
		{ path: 'constructs/auth.ts', content: authConstruct(options) },
		{ path: 'constructs/api.ts', content: apiConstruct(options) },
		{ path: 'constructs/email.ts', content: emailConstruct() },
		{
			path: 'constructs/templates/MagicLink.tsx',
			content: magicLinkTemplate(options.name),
		},
		{
			path: 'constructs/templates/layout.tsx',
			content: emailLayout(options.name),
		},
		// Its migrations and seeds beside it, in the folder its name gives.
		workspaceUsersMigration(),
		accessControlMigration(),
		...accessControlSeeds(options),
	];

	if (uploads) {
		const bucket = storageFor();
		files.push({
			path: 'constructs/storage.ts',
			content: `import { ObjectStorage } from '@geekmidas/constructs/object-storage';

/** A bucket — MinIO locally, S3 deployed, one declaration for both. */
export const uploads = new ObjectStorage('${bucket.id}');
`,
		});
	}

	if (cache) {
		const kv = cacheFor();
		files.push({
			path: 'constructs/cache.ts',
			content: `import { Cache } from '@geekmidas/constructs/cache';

/**
 * A cache. Which backend serves it follows the deploy target — a table in the
 * database on a server, Upstash on AWS — so nothing here says where it lives.
 */
export const cache = new Cache('${kv.id}');
`,
		});
	}

	return files;
}
