import { databaseFiles, databaseFor } from '../constructs.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from './index.js';

export const minimalTemplate: TemplateConfig = {
	name: 'minimal',
	description: 'Basic health endpoint',

	dependencies: {
		'@geekmidas/audit': GEEKMIDAS_VERSIONS['@geekmidas/audit'],
		'@geekmidas/constructs': GEEKMIDAS_VERSIONS['@geekmidas/constructs'],
		'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
		'@geekmidas/logger': GEEKMIDAS_VERSIONS['@geekmidas/logger'],
		'@geekmidas/rate-limit': GEEKMIDAS_VERSIONS['@geekmidas/rate-limit'],
		'@geekmidas/schema': GEEKMIDAS_VERSIONS['@geekmidas/schema'],
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
		const { loggerType, routesStructure, name } = options;

		// The id and env keys the scaffolded database owns.
		const db = databaseFor(name);

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
		];

		// The database — a construct, not a hand-written service.
		if (options.database) {
			files.push(...databaseFiles(name));
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
import type { Database } from './constructs/database.ts';
import { envParser } from './config/env.ts';

// The key the database construct publishes — not a hand-written DATABASE_URL.
const studioConfig = envParser
  .create((get) => ({
    databaseUrl: get('${db.urlKey}').string(),
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
