import type {
  GeneratedFile,
  TemplateConfig,
  TemplateOptions,
} from './index.js';

export const minimalTemplate: TemplateConfig = {
  name: 'minimal',
  description: 'Basic health endpoint',

  dependencies: {
    '@geekmidas/constructs': 'workspace:*',
    '@geekmidas/envkit': 'workspace:*',
    '@geekmidas/logger': 'workspace:*',
    hono: '~4.8.2',
    pino: '~9.6.0',
  },

  devDependencies: {
    '@biomejs/biome': '~1.9.4',
    '@geekmidas/cli': 'workspace:*',
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
        content: `import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env);

export const config = envParser
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    nodeEnv: get('NODE_ENV').string().default('development'),
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

export default e
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
      // Update env.ts to include database config
      files[0] = {
        path: 'src/config/env.ts',
        content: `import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env);

export const config = envParser
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    nodeEnv: get('NODE_ENV').string().default('development'),
    database: {
      url: get('DATABASE_URL').string().default('postgresql://localhost:5432/mydb'),
    },
  }))
  .parse();
`,
      };

      files.push({
        path: 'src/services/database.ts',
        content: `import type { Service } from '@geekmidas/services';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Define your database schema
export interface Database {
  // Add your tables here
}

export const databaseService = {
  serviceName: 'database' as const,
  async register(envParser) {
    const config = envParser
      .create((get) => ({
        url: get('DATABASE_URL').string(),
      }))
      .parse();

    return new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: config.url }),
      }),
    });
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
        content: `import { Studio } from '@geekmidas/studio';
import { InMemoryMonitoringStorage } from '@geekmidas/studio';
import { databaseService, type Database } from '../services/database';

export const studio = new Studio<Database>({
  database: databaseService,
  monitoring: {
    storage: new InMemoryMonitoringStorage({ maxEntries: 100 }),
    enabled: process.env.NODE_ENV === 'development',
  },
});
`,
      });
    }

    return files;
  },
};
