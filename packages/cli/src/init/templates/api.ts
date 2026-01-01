import type {
  GeneratedFile,
  TemplateConfig,
  TemplateOptions,
} from './index.js';

export const apiTemplate: TemplateConfig = {
  name: 'api',
  description: 'Full API with auth, database, services',

  dependencies: {
    '@geekmidas/constructs': 'workspace:*',
    '@geekmidas/envkit': 'workspace:*',
    '@geekmidas/logger': 'workspace:*',
    '@geekmidas/services': 'workspace:*',
    '@geekmidas/errors': 'workspace:*',
    '@geekmidas/auth': 'workspace:*',
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
        content: `import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env);

export const config = envParser
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    nodeEnv: get('NODE_ENV').string().default('development'),
    jwtSecret: get('JWT_SECRET').string().default('change-me-in-production'),${
      options.database
        ? `
    database: {
      url: get('DATABASE_URL').string().default('postgresql://localhost:5432/mydb'),
    },`
        : ''
    }
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

      // users endpoints
      {
        path: getRoutePath('users/list.ts'),
        content: `import { e } from '@geekmidas/constructs/endpoints';

export default e
  .get('/users')
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
        content: `import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export default e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .handle(async ({ params }) => ({
    id: params.id,
    name: 'Alice',
    email: 'alice@example.com',
  }));
`,
      },
    ];

    // Add database service if enabled
    if (options.database) {
      files.push({
        path: 'src/services/database.ts',
        content: `import type { Service } from '@geekmidas/services';
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
