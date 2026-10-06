import {
	cacheFor,
	databaseFiles,
	databaseFor,
	emailFor,
	storageFor,
} from '../constructs.js';
import { DEPENDENCY_VERSIONS, TOOLCHAIN_VERSIONS } from '../dependencies.js';
import { stageEnv } from '../generators/stages.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from './index.js';

export const apiTemplate: TemplateConfig = {
	name: 'api',
	description: 'Full API with auth, database, services',

	dependencies: {
		'@geekmidas/audit': GEEKMIDAS_VERSIONS['@geekmidas/audit'],
		'@geekmidas/constructs': GEEKMIDAS_VERSIONS['@geekmidas/constructs'],
		'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
		'@geekmidas/events': GEEKMIDAS_VERSIONS['@geekmidas/events'],
		'@geekmidas/logger': GEEKMIDAS_VERSIONS['@geekmidas/logger'],
		'@geekmidas/rate-limit': GEEKMIDAS_VERSIONS['@geekmidas/rate-limit'],
		'@geekmidas/schema': GEEKMIDAS_VERSIONS['@geekmidas/schema'],
		'@geekmidas/services': GEEKMIDAS_VERSIONS['@geekmidas/services'],
		'@geekmidas/errors': GEEKMIDAS_VERSIONS['@geekmidas/errors'],
		'@geekmidas/auth': GEEKMIDAS_VERSIONS['@geekmidas/auth'],
		'@hono/node-server': DEPENDENCY_VERSIONS['@hono/node-server'],
		hono: DEPENDENCY_VERSIONS.hono,
		zod: DEPENDENCY_VERSIONS.zod,
	},

	devDependencies: {
		'@biomejs/biome': DEPENDENCY_VERSIONS['@biomejs/biome'],
		'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
		'@types/node': DEPENDENCY_VERSIONS['@types/node'],
		esbuild: TOOLCHAIN_VERSIONS['esbuild'],
		tsx: TOOLCHAIN_VERSIONS['tsx'],
		turbo: DEPENDENCY_VERSIONS['turbo'],
		typescript: TOOLCHAIN_VERSIONS['typescript'],
		vitest: TOOLCHAIN_VERSIONS['vitest'],
	},

	scripts: {
		dev: 'gkm dev',
		build: 'gkm build',
		test: 'vitest',
		'test:once': 'vitest run',
		typecheck: 'tsc --noEmit',
		lint: 'biome lint .',
		fmt: 'biome format . --write',
		'fmt:check': 'biome format .',
	},

	files: (options: TemplateOptions): GeneratedFile[] => {
		const { loggerType, routesStructure, monorepo, name } = options;
		const { cache, uploads, mail: sendsMail } = options.constructs;

		// The ids and env keys the scaffolded constructs own. Derived, so the
		// files below and the runtime that discovers them cannot disagree.
		const bucket = storageFor();
		const kv = cacheFor();
		const db = databaseFor();
		const mail = emailFor();

		// Every layout's tsconfig maps `~/*` to `src/*`, so a generated file
		// imports through it wherever it sits. A single app wrote `./router.ts`
		// from `src/endpoints/…`, which named a file that is not there.
		const src = (path: string) => `~/${path}`;

		// Whether this app declares its infrastructure.
		//
		// Single-app projects do: the config gets a `constructs` glob, reconcile
		// derives their containers, and the handler reaches them by edge. The
		// fullstack workspace does not yet — its auth app's database role is
		// created by `docker/postgres/init.sh` and its URL comes from a
		// per-app secret, neither of which reconcile knows about, so declaring
		// only the API's half would leave auth pointing at a container that is
		// no longer the one running.
		// In a workspace the constructs live at its root — `generateRootConstructs`
		// writes them — so the app declares none of its own and imports them
		// through the `@<name>/constructs/*` alias instead. A single-app project
		// has no root above it, so they stay in `src/constructs/`.
		const declares = !monorepo;

		const loggerContent = `import { createLogger } from '@geekmidas/logger/${loggerType}';

export const logger = createLogger();
`;

		// Models package import path for monorepo
		const modelsImport = monorepo ? `@${name}/models` : null;

		// Get route path based on structure
		const getRoutePath = (file: string) => {
			switch (routesStructure) {
				case 'centralized-endpoints':
					return `src/endpoints/${file}`;
				case 'centralized-routes':
					return `src/routes/${file}`;
				case 'domain-based': {
					const parts = file.split('/');
					if (parts.length === 1) {
						return `src/${file.replace('.ts', '')}/routes/index.ts`;
					}
					return `src/${parts[0]}/routes/${parts.slice(1).join('/')}`;
				}
			}
		};

		// Where an endpoint file reaches the surface from — one level deeper when
		// the routes are nested by domain.
		/**
		 * Where a file at the app's `src/` root reaches a construct.
		 *
		 * A workspace keeps them at its own root, so the app goes through the
		 * `@<name>/constructs/*` alias rather than climbing out with `../../`.
		 */
		const constructsImport = (file: string) =>
			monorepo ? `@${name}/constructs/${file}.ts` : `./constructs/${file}.ts`;

		const apiImport = monorepo
			? `@${name}/constructs/api.ts`
			: routesStructure === 'domain-based'
				? '../../constructs/api.js'
				: '../constructs/api.js';

		const files: GeneratedFile[] = [
			// The application's HTTP surface. Endpoints are built from it, so each
			// one carries the logger and environment parser its adaptor needs —
			// nothing has to be named in config and nothing printed into the
			// generated handler.
			//
			// A workspace declares it at its root instead, beside the site and the
			// auth server that depend on it.
			...(declares
				? [
						{
							path: 'src/constructs/api.ts',
							content: `import { RestApi } from '@geekmidas/constructs/rest-api';
import { logger } from '../config/logger.ts';

export const api = new RestApi('Api', {
  // The project is the app.
  path: '.',

  // Typed out rather than omitted: an API that ships open because a field was
  // left off is the one default worth refusing to have.
  defaultAuthorizer: 'none',

  // The actual logger, not a path to one. Every endpoint built from this
  // surface runs with it, and so does the generated entry.
  logger,
});
`,
						},
					]
				: []),

			// src/config/env.ts
			{
				path: 'src/config/env.ts',
				content: `import { Credentials } from '@geekmidas/envkit/credentials';
import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser({ ...process.env, ...Credentials });

// Global config - only minimal shared values
// Service-specific config should be parsed in each service
export const config = envParser
  .create((get) => ({
    nodeEnv: get('NODE_ENV').enum(['development', 'test', 'production']).default('development'),
    stage: ${stageEnv(options.stages)},
  }))
  .parse();
`,
			},

			// src/config/logger.ts
			{
				path: 'src/config/logger.ts',
				content: loggerContent,
			},

			// health endpoint
			{
				path: getRoutePath('health.ts'),
				content: monorepo
					? `import { z } from 'zod';
import { router } from '~/router.ts';

export const healthEndpoint = router
  .get('/health')
  .output(z.object({
    status: z.string(),
    timestamp: z.string(),
  }))
  .handle(async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
`
					: `import { z } from 'zod';
import { router } from '~/router.ts';

export const healthEndpoint = router
  .get('/health')
  .output(z.object({
    status: z.string(),
    timestamp: z.string(),
  }))
  .handle(async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
`,
			},

			// users endpoints
			{
				path: getRoutePath('users/list.ts'),
				content: modelsImport
					? `import { ListUsersResponseSchema } from '${modelsImport}/user';
import { router } from '${src('router.ts')}';

export const listUsersEndpoint = router
  .get('/users')
  .output(ListUsersResponseSchema)
${
	options.constructs.database
		? `  // \`db\` is here because the router named the database construct.
  .handle(async ({ db }) => ({
    users: await db.selectFrom('users').select(['id', 'name']).execute(),
  }));
`
		: `  .handle(async () => ({
    users: [
      { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Alice' },
      { id: '550e8400-e29b-41d4-a716-446655440002', name: 'Bob' },
    ],
  }));
`
}`
					: `import { z } from 'zod';
import { router } from '${src('router.ts')}';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const listUsersEndpoint = router
  .get('/users')
  .output(z.object({
    users: z.array(UserSchema),
  }))
${
	options.constructs.database
		? `  // \`db\` is here because the router named the database construct.
  .handle(async ({ db }) => ({
    users: await db.selectFrom('users').select(['id', 'name']).execute(),
  }));
`
		: `  .handle(async () => ({
    users: [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ],
  }));
`
}`,
			},
			{
				path: getRoutePath('users/get.ts'),
				content: modelsImport
					? `import { IdParamsSchema } from '${modelsImport}/common';
import { UserResponseSchema } from '${modelsImport}/user';
import { router } from '${src('router.ts')}';

export const getUserEndpoint = router
  .get('/users/:id')
  .params(IdParamsSchema)
  .output(UserResponseSchema)
  .handle(async ({ params }) => ({
    id: params.id,
    name: 'Alice',
    email: 'alice@example.com',
  }));
`
					: `import { z } from 'zod';
import { router } from '${src('router.ts')}';

export const getUserEndpoint = router
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
  }))
  .handle(async ({ params }) => ({
    id: params.id,
    name: 'Alice',
    email: 'alice@example.com',
  }));
`,
			},
		];

		// The monorepo router: the API names the auth construct (`.auth(auth)` at
		// the root), so the session comes from it rather than a service that
		// fetches the auth server by hand.
		if (options.monorepo) {
			// Add router with session
			files.push({
				path: 'src/router.ts',
				content: `import { UnauthorizedError } from '@geekmidas/errors';
import { api } from '${constructsImport('api')}';${
					options.constructs.database
						? `
import { database } from '${constructsImport('database')}';`
						: ''
				}

/**
 * The shared endpoint factory — no session required.
 *${
		options.constructs.database
			? `
 * Naming the database construct is what puts \`db\` in every handler built from
 * this router. Depend on other constructs per endpoint with \`.dependsOn([…])\`.`
			: `
 * Depend on constructs per endpoint with \`.dependsOn([…])\`.`
 }
 */
export const router = api${options.constructs.database ? '.database(database)' : ''};

/**
 * Requires an active session — throws when there is none.
 *
 * \`auth\` is the construct named in \`.auth()\` on the API, bound to this
 * request: it asks the auth server whose cookie this is. Handlers built from
 * this router get whatever this returns as \`session\`.
 */
export const sessionRouter = router.session(async ({ auth }) => {
  const session = await auth.getSession();

  if (!session) {
    throw new UnauthorizedError('No active session');
  }

  return session;
});
`,
			});

			// Add protected endpoint example
			files.push({
				path: getRoutePath('profile.ts'),
				content: `import { z } from 'zod';
import { sessionRouter } from '~/router.ts';

export const profileEndpoint = sessionRouter
  .get('/profile')
  .output(z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
  }))
  .handle(async ({ session }) => session.user);
`,
			});
		}

		// The non-monorepo router. The monorepo one is written above, with the
		// session extractor its auth app needs.
		if (!monorepo) {
			files.push({
				path: 'src/router.ts',
				content: `import { api } from '${constructsImport('api')}';${
					options.constructs.database
						? `
import { database } from '${constructsImport('database')}';`
						: ''
				}

/**
 * The shared endpoint factory.
 *${
		options.constructs.database
			? `
 * Naming the database construct is what puts \`db\` in every handler built from
 * this router. Depend on other constructs per endpoint with \`.dependsOn([…])\`.`
			: `
 * Depend on constructs per endpoint with \`.dependsOn([…])\`.`
 }
 */
export const router = api${options.constructs.database ? '.database(database)' : ''};
`,
			});
		}

		// The database — a construct, not a hand-written service. A workspace
		// declares it, and keeps its migrations, at its root.
		if (options.constructs.database && declares) {
			files.push(...databaseFiles());
		}

		// Object storage — MinIO locally, S3 deployed, one declaration for both.
		if (uploads && declares) {
			files.push({
				path: 'src/constructs/storage.ts',
				content: `import { ObjectStorage } from '@geekmidas/constructs/object-storage';

/**
 * A bucket, declared once.
 *
 * Reach it from an endpoint with \`.dependsOn([uploads])\`, which is what makes
 * \`services.${bucket.service}\` exist and type — and what tells the deploy
 * target to grant that handler S3 access, and nothing else.
 */
export const uploads = new ObjectStorage('${bucket.id}');
`,
			});
		}

		// Mail. Mailpit locally, SES/Resend/SMTP deployed — one client either
		// way, because every backend speaks SMTP.
		if (sendsMail && declares) {
			files.push({
				path: 'src/constructs/email.ts',
				content: `import { Email } from '@geekmidas/constructs/email';

/**
 * Outbound mail, declared once.
 *
 * Add React templates to \`templates\` and \`sendTemplate\` becomes typed
 * against them. Reach it with \`.dependsOn([email])\` for
 * \`services.${mail.service}\`. Who delivers it is whichever provider the
 * stage's \`${mail.urlKey}\` points at — every one of them speaks SMTP.
 */
export const email = new Email('${mail.id}', { templates: {} });
`,
			});
		}

		// A cache. Where it lives when deployed follows from the deploy target;
		// the application code is the same either way.
		if (cache && declares) {
			files.push({
				path: 'src/constructs/cache.ts',
				content: `import { Cache } from '@geekmidas/constructs/cache';

/**
 * A cache, declared once.
 *
 * Reach it with \`.dependsOn([cache])\` for \`services.${kv.service}\`. This
 * form says the app caches and leaves *where* to the deployment: Upstash on
 * AWS, a table in the database on a server — the same code caches into
 * either.
 *
 * To say it caches in a particular database instead, declare it from that
 * database — \`database.cache()\` — and entries become a table in it, in its
 * schema and reached by its role, whatever the target.
 */
export const cache = new Cache('${kv.id}');
`,
			});
		}

		// Add Telescope config if enabled
		if (options.telescope) {
			files.push({
				path: 'src/config/telescope.ts',
				content: `import { Telescope } from '@geekmidas/telescope';
import { InMemoryStorage } from '@geekmidas/telescope/storage/memory';

export const telescope = new Telescope({
  storage: new InMemoryStorage({ maxEntries: 100 }),
  enabled: process.env.NODE_ENV === 'development',
});
`,
			});
		}

		return files;
	},
};
