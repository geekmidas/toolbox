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
		const { loggerType, routesStructure, monorepo, name } = options;

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
import { publicRouter } from '~/router';

export const healthEndpoint = publicRouter
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
					: `import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const healthEndpoint = e
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
					? `import { e } from '@geekmidas/constructs/endpoints';
import { ListUsersResponseSchema } from '${modelsImport}/user';

export const listUsersEndpoint = e
  .get('/users')
  .output(ListUsersResponseSchema)
  .handle(async () => ({
    users: [
      { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Alice' },
      { id: '550e8400-e29b-41d4-a716-446655440002', name: 'Bob' },
    ],
  }));
`
					: `import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const listUsersEndpoint = e
  .get('/users')
  .output(z.object({
    users: z.array(UserSchema),
  }))
  .handle(async () => ({
    users: [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ],
  }));
`,
			},
			{
				path: getRoutePath('users/get.ts'),
				content: modelsImport
					? `import { e } from '@geekmidas/constructs/endpoints';
import { IdParamsSchema } from '${modelsImport}/common';
import { UserResponseSchema } from '${modelsImport}/user';

export const getUserEndpoint = e
  .get('/users/:id')
  .params(IdParamsSchema)
  .output(UserResponseSchema)
  .handle(async ({ params }) => ({
    id: params.id,
    name: 'Alice',
    email: 'alice@example.com',
  }));
`
					: `import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const getUserEndpoint = e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
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
import { UnauthorizedError } from '@geekmidas/errors';
import { authService, type Session } from './services/auth.js';
import { logger } from './config/logger.js';

// Public router - no auth required
export const publicRouter = e.logger(logger);

// Router with auth service available (but session not enforced)
export const r = publicRouter.services([authService]);

// Session router - requires active session, throws if not authenticated
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
import { sessionRouter } from '~/router';

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

		// Add database service if enabled
		if (options.database) {
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
import type { Database } from '../services/database.js';
import { envParser } from './env.js';

// Parse database config for Studio
const studioConfig = envParser
  .create((get) => ({
    databaseUrl: get('DATABASE_URL').string(),
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
