import type {
  GeneratedFile,
  TemplateConfig,
  TemplateOptions,
} from './index.js';

export const workerTemplate: TemplateConfig = {
  name: 'worker',
  description: 'Background job processing',

  dependencies: {
    '@geekmidas/constructs': 'workspace:*',
    '@geekmidas/envkit': 'workspace:*',
    '@geekmidas/logger': 'workspace:*',
    '@geekmidas/events': 'workspace:*',
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
    rabbitmq: {
      url: get('RABBITMQ_URL').string().default('amqp://localhost:5672'),
    },${
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

      // src/config/logger.ts - using pino
      {
        path: 'src/config/logger.ts',
        content: `import { PinoLogger } from '@geekmidas/logger/pino';

export const logger = new PinoLogger({
  app: '${options.name}',
  level: process.env.LOG_LEVEL || 'info',
});
`,
      },

      // src/endpoints/health.ts
      {
        path: 'src/endpoints/health.ts',
        content: `import { e } from '@geekmidas/constructs/endpoints';

export default e
  .get('/health')
  .handle(async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
`,
      },

      // src/events/types.ts
      {
        path: 'src/events/types.ts',
        content: `import type { PublishableMessage } from '@geekmidas/events';

// Define your event types here
export type AppEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: Record<string, unknown> }>
  | PublishableMessage<'order.placed', { orderId: string; userId: string; total: number }>;
`,
      },

      // src/subscribers/user-events.ts
      {
        path: 'src/subscribers/user-events.ts',
        content: `import { s } from '@geekmidas/constructs/subscribers';
import type { AppEvents } from '../events/types.js';

export default s<AppEvents>()
  .events(['user.created', 'user.updated'])
  .handle(async ({ event, logger }) => {
    logger.info({ type: event.type, payload: event.payload }, 'Processing user event');

    switch (event.type) {
      case 'user.created':
        // Handle user creation
        logger.info({ userId: event.payload.userId }, 'New user created');
        break;
      case 'user.updated':
        // Handle user update
        logger.info({ userId: event.payload.userId }, 'User updated');
        break;
    }
  });
`,
      },

      // src/crons/cleanup.ts
      {
        path: 'src/crons/cleanup.ts',
        content: `import { cron } from '@geekmidas/constructs/crons';

// Run every day at midnight
export default cron('0 0 * * *')
  .handle(async ({ logger }) => {
    logger.info('Running cleanup job');

    // Add your cleanup logic here
    // e.g., delete old sessions, clean up temp files, etc.

    logger.info('Cleanup job completed');
  });
`,
      },
    ];

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
