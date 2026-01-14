import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from './index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

export const minimalTemplate: TemplateConfig = {
	name: 'minimal',
	description: 'Basic health endpoint',

	dependencies: {
		'@geekmidas/constructs': GEEKMIDAS_VERSIONS['@geekmidas/constructs'],
		'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
		'@geekmidas/logger': GEEKMIDAS_VERSIONS['@geekmidas/logger'],
		hono: '~4.8.2',
		pino: '~9.6.0',
	},

	devDependencies: {
		'@biomejs/biome': '~2.3.0',
		'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
		'@types/node': '~22.0.0',
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
		const { loggerType, routesStructure } = options;

		const loggerContent = `import { createLogger } from '@geekmidas/logger/${loggerType}';

export const logger = createLogger();
`;

		// Get route path based on structure
		const getRoutePath = (file: string) => {
			switch (routesStructure) {
				case 'centralized-endpoints':
					return `src/endpoints/${file}`;
				case 'centralized-routes':
					return `src/routes/${file}`;
				case 'domain-based':
					return `src/${file.replace('.ts', '')}/routes/index.ts`;
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
				content: `import { e } from '@geekmidas/constructs/endpoints';

export const healthEndpoint = e
  .get('/health')
  .handle(async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
`,
			},
		];

		// Add database service if enabled
		if (options.database) {
			files.push({
				path: 'src/services/database.ts',
				content: `import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Define your database schema
export interface Database {
  // Add your tables here
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
import type { Database } from '../services/database';
import { config } from './env';

// Create a Kysely instance for Studio
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: config.database.url }),
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
