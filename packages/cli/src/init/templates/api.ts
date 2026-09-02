import {
	cacheFor,
	databaseFiles,
	databaseFor,
	emailFor,
	storageFor,
} from '../constructs.js';
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
		'@hono/node-server': '~1.14.1',
		hono: '~4.8.2',
		pino: '~9.6.0',
		zod: '~4.1.0',
	},

	devDependencies: {
		'@biomejs/biome': '~2.3.0',
		'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
		'@types/node': '~22.0.0',
		esbuild: '~0.27.0',
		tsx: '~4.20.0',
		turbo: '~2.3.0',
		typescript: '~5.8.2',
		vitest: '~4.0.0',
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
		const { loggerType, routesStructure, monorepo, name, services } = options;

		// The ids and env keys the scaffolded constructs own. Derived, so the
		// files below and the runtime that discovers them cannot disagree.
		const bucket = storageFor(name);
		const kv = cacheFor(name);
		const db = databaseFor(name);
		const mail = emailFor(name);

		// Single-app projects have no `~/*` alias, so what a generated file
		// imports depends on where it will sit.
		const src = (path: string) => (monorepo ? `~/${path}` : `./${path}`);

		// Whether this app declares its infrastructure.
		//
		// Single-app projects do: the config gets a `constructs` glob, reconcile
		// derives their containers, and the handler reaches them by edge. The
		// fullstack workspace does not yet — its auth app's database role is
		// created by `docker/postgres/init.sh` and its URL comes from a
		// per-app secret, neither of which reconcile knows about, so declaring
		// only the API's half would leave auth pointing at a container that is
		// no longer the one running.
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

		const files: GeneratedFile[] = [
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
    stage: get('STAGE').enum(['development', 'staging', 'production']).default('development'),
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
import { router } from './router.ts';

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
	options.database
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
	options.database
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

		// Add auth service for monorepo (calls auth app for session)
		if (options.monorepo) {
			files.push({
				path: 'src/services/auth.ts',
				content: `import type { Service, ServiceRegisterOptions } from '@geekmidas/services';

export interface Session {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export interface AuthClient {
  getSession: (cookie: string) => Promise<Session | null>;
}

export const authService = {
  serviceName: 'auth' as const,
  async register({ envParser, context }: ServiceRegisterOptions) {
    const logger = context.getLogger();

    const config = envParser
      .create((get) => ({
        url: get('AUTH_URL').string(),
      }))
      .parse();

    logger.info({ authUrl: config.url }, 'Auth service configured');

    return {
      getSession: async (cookie: string): Promise<Session | null> => {
        const res = await fetch(\`\${config.url}/api/auth/get-session\`, {
          headers: { cookie },
        });
        if (!res.ok) return null;
        return res.json();
      },
    };
  },
} satisfies Service<'auth', AuthClient>;
`,
			});

			// Add router with session
			files.push({
				path: 'src/router.ts',
				content: `import { e } from '@geekmidas/constructs/endpoints';
import { UnauthorizedError } from '@geekmidas/errors';${
					options.database
						? `
import { database } from './constructs/database.ts';`
						: ''
				}
import { authService, type Session } from './services/auth.ts';
import { logger } from './config/logger.ts';

/**
 * The shared endpoint factory — no session required.
 *${
		options.database
			? `
 * Naming the database construct is what puts \`db\` in every handler built from
 * this router. Depend on other constructs per endpoint with \`.dependsOn([…])\`.`
			: `
 * Depend on constructs per endpoint with \`.dependsOn([…])\`.`
 }
 */
export const router = e.logger(logger)${options.database ? '.database(database)' : ''};

// The auth client available, but the session not enforced.
export const r = router.services([authService]);

// Requires an active session — throws when there is none.
export const sessionRouter = r.session<Session>(async ({ services, header }) => {
  const cookie = header('cookie') || '';
  const session = await services.auth.getSession(cookie);

  if (!session?.user) {
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
				content: `import { e } from '@geekmidas/constructs/endpoints';
import { logger } from './config/logger.ts';${
					options.database
						? `
import { database } from './constructs/database.ts';`
						: ''
				}

/**
 * The shared endpoint factory.
 *${
		options.database
			? `
 * Naming the database construct is what puts \`db\` in every handler built from
 * this router. Depend on other constructs per endpoint with \`.dependsOn([…])\`.`
			: `
 * Depend on constructs per endpoint with \`.dependsOn([…])\`.`
 }
 */
export const router = e.logger(logger)${options.database ? '.database(database)' : ''};
`,
			});
		}

		// The database — a construct, not a hand-written service.
		if (options.database && declares) {
			files.push(...databaseFiles(name));
		}

		// Object storage — MinIO locally, S3 deployed, one declaration for both.
		if (services.storage && declares) {
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
		if (services.mail && declares) {
			files.push({
				path: 'src/constructs/email.ts',
				content: `import { Email } from '@geekmidas/constructs/email';

/**
 * Outbound mail, declared once.
 *
 * Add React templates to \`templates\` and \`sendTemplate\` becomes typed
 * against them. Reach it with \`.dependsOn([email])\` for
 * \`services.${mail.service}\`; who delivers it is \`services.mail\` in
 * \`gkm.config.ts\`.
 */
export const email = new Email('${mail.id}', { templates: {} });
`,
			});
		}

		// A cache. Where it lives when deployed is `services.cache` in the
		// config; the application code is the same either way.
		if (services.cache && declares) {
			files.push({
				path: 'src/constructs/cache.ts',
				content: `import { Cache } from '@geekmidas/constructs/cache';

/**
 * A cache, declared once.
 *
 * Reach it with \`.dependsOn([cache])\` for \`services.${kv.service}\`. Which
 * backend serves it — Upstash, ElastiCache, or the database — is
 * \`services.cache\` in \`gkm.config.ts\`, because the same code caches into
 * any of them.
 */
export const cache = new Cache('${kv.id}');
`,
			});
		}

		// The workspace path, until its auth app declares its own half.
		if (options.database && !declares) {
			files.push({
				path: 'src/services/database.ts',
				content: `import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Define your database schema
export interface Database {
  users: {
    id: string;
    name: string;
    email: string;
    created_at: Date;
  };
}

export const databaseService = {
  serviceName: 'database' as const,
  async register({ envParser, context }: ServiceRegisterOptions) {
    const logger = context.getLogger();
    logger.info('Connecting to database');

    const config = envParser
      .create((get) => ({
        url: get('DATABASE_URL').string(),
      }))
      .parse();

    const db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: config.url }),
      }),
    });

    logger.info('Database connection established');
    return db;
  },
} satisfies Service<'database', Kysely<Database>>;
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

		// Add Studio config if enabled (requires database)
		if (options.studio && options.database) {
			files.push({
				path: 'src/config/studio.ts',
				content: `import { Direction, InMemoryMonitoringStorage, Studio } from '@geekmidas/studio';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '${src(declares ? 'constructs/database.ts' : 'services/database.ts')}';
import { envParser } from '${src('config/env.ts')}';

const studioConfig = envParser
  .create((get) => ({
    databaseUrl: get('${declares ? db.urlKey : 'DATABASE_URL'}').string(),
  }))
  .parse();

// Create a Kysely instance for Studio
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: studioConfig.databaseUrl }),
  }),
});

export const studio = new Studio<Database>({
  monitoring: {
    storage: new InMemoryMonitoringStorage({ maxEntries: 100 }),
  },
  data: {
    db,
    cursor: { field: 'id', direction: Direction.Desc },
  },
  enabled: process.env.NODE_ENV === 'development',
});
`,
			});
		}

		return files;
	},
};
