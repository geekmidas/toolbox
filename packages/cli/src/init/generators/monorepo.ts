import { cacheFor, databaseFor, emailFor, storageFor } from '../constructs.js';
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
			...(isFullstack
				? { storybook: 'pnpm --filter ./packages/ui storybook' }
				: {}),
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
			tsx: '~4.20.0',
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
			// How an app reaches the workspace's constructs without climbing out
			// of its own directory with `../../`.
			...(isFullstack
				? {
						baseUrl: '.',
						paths: {
							[`@${options.name}/constructs/*`]: ['./constructs/*'],
						},
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
	let config = `import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  // The scope every physical name is built from: \`Database\` becomes
  // \`production-${options.name}-database\` on Dokploy and on AWS alike.
  name: '${options.name}',

  // One glob, every kind. A declared database is why a Postgres exists, a
  // declared bucket is why MinIO does, a declared topic is why a broker does —
  // none of it listed here. It is also where the apps come from: a
  // \`StaticSite\` is an app, and so is every \`RestApi\`.
  constructs: './constructs/**/*.ts',

  secrets: {
    enabled: true,
  },
});
`;

	// The one thing a construct cannot answer and a default cannot either.
	//
	// `services.events` is doing two jobs — *are there events* and *which
	// broker carries them* — so an unset value means "none" rather than "the
	// obvious one", and defaulting it would assert events exist for a project
	// that declared no topic. Written only when the choice is not the one
	// `pgboss` already gives for free.
	if (options.services.events && options.services.events !== 'pgboss') {
		config = config.replace(
			'  secrets: {',
			`  services: {
    events: '${options.services.events}',
  },

  secrets: {`,
		);
	}

	return config;
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

	const { name, services, frontendFramework } = options;
	const db = databaseFor(name);
	const files: GeneratedFile[] = [];

	files.push({
		path: 'constructs/logger.ts',
		content: `import { createLogger } from '@geekmidas/logger/${options.loggerType}';

/**
 * The logger every endpoint runs with.
 *
 * Named once, here, because the surface carries it. It used to be
 * \`logger: './src/config/logger#logger'\` in config — a module path the build
 * printed into each generated handler, checked by nothing and wrong the moment
 * the file moved.
 */
export const logger = createLogger();
`,
	});

	files.push({
		path: 'constructs/database.ts',
		content: `import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import type { Generated } from 'kysely';

/** Your database schema. Add tables here. */
export interface Database {
  users: {
    id: Generated<string>;
    name: string;
    email: string;
    created_at: Generated<Date>;
  };
}

/**
 * The database, declared once.
 *
 * The container, the database inside it, its roles and schema, and
 * \`${db.urlKey}\` all derive from this line — which is why nothing lists
 * \`postgres\` anywhere.
 */
export const database = new KyselyDatabase<Database, '${db.id}'>('${db.id}');

/**
 * The auth server's own schema in that same Postgres, with its own role.
 *
 * A schema tenant rather than a second database: one container, and a role
 * whose \`search_path\` is pinned, so Better Auth's tables cannot collide with
 * the application's.
 */
export const authDb = database.schema<Record<string, never>, 'AuthDb'>('AuthDb');
`,
	});

	files.push({
		path: 'constructs/auth.ts',
		content: `import { BetterAuth } from '@geekmidas/constructs/auth';
import { authDb } from './database.ts';

/**
 * The auth server.
 *
 * There is no \`src/index.ts\` to go with this, and that is the point: the
 * routes are a wildcard, so no glob finds them and the build generates the
 * entry from this declaration instead. CORS, the trusted origins and the
 * cookie domain come from whatever declared an edge to it — nobody writes an
 * origin down.
 */
export const auth = new BetterAuth('Auth', {
  database: authDb,
  basePath: '/api/auth',
});
`,
	});

	files.push({
		path: 'constructs/api.ts',
		content: `import { RestApi } from '@geekmidas/constructs/rest-api';
import { auth } from './auth.ts';
import { logger } from './logger.ts';

/**
 * The application's HTTP surface — one RestApi, one container.
 *
 * No \`app\`: \`Api\` means \`apps/api\`, which the id already said. The
 * \`code\` glob is here only because this scaffold puts its endpoints under
 * \`src/\`, where the conventional layout has them at the app root.
 */
export const api = new RestApi('Api', {
  // Typed out rather than omitted: an API that ships open because a field was
  // left off is the one default worth refusing to have.
  defaultAuthorizer: 'none',

  // The actual logger, not a path to one.
  logger,

  app: {
    code: './src/{endpoints,functions,crons,queues,topics,subscribers}/**/*.ts',
  },
}).auth(auth);
`,
	});

	const variant =
		frontendFramework === 'tanstack-start'
			? "{ variant: 'tanstack' }"
			: frontendFramework === 'expo'
				? undefined
				: "{ variant: 'next' }";

	if (variant !== undefined) {
		files.push({
			path: 'constructs/site.ts',
			content: `import { StaticSite } from '@geekmidas/constructs/site';
import { api } from './api.ts';
import { auth } from './auth.ts';

/**
 * The frontend — a construct like any other, which is what makes it an app.
 *
 * No \`path\`: \`Web\` means \`apps/web\`. \`.dependsOn()\` is the single fact
 * behind four things that are hand-maintained otherwise: this site's
 * build-time API URL, the API's CORS origins, the auth server's trusted
 * origins, and which generated client lands here.
 */
export const web = new StaticSite('Web', ${variant}).dependsOn([api, auth]);
`,
		});
	}

	if (services.storage) {
		const bucket = storageFor(name);
		files.push({
			path: 'constructs/storage.ts',
			content: `import { ObjectStorage } from '@geekmidas/constructs/object-storage';

/** A bucket — MinIO locally, S3 deployed, one declaration for both. */
export const uploads = new ObjectStorage('${bucket.id}');
`,
		});
	}

	if (services.mail) {
		const mail = emailFor(name);
		files.push({
			path: 'constructs/email.ts',
			content: `import { Email } from '@geekmidas/constructs/email';

/** Outbound mail — Mailpit locally, SES deployed. */
export const email = new Email('${mail.id}', { templates: {} });
`,
		});
	}

	if (services.cache) {
		const kv = cacheFor(name);
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
