import { GEEKMIDAS_VERSIONS } from '../versions.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from './index.js';

export const workerTemplate: TemplateConfig = {
	name: 'worker',
	description: 'Background job processing',

	dependencies: {
		'@geekmidas/audit': GEEKMIDAS_VERSIONS['@geekmidas/audit'],
		'@geekmidas/constructs': GEEKMIDAS_VERSIONS['@geekmidas/constructs'],
		'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
		'@geekmidas/events': GEEKMIDAS_VERSIONS['@geekmidas/events'],
		'@geekmidas/logger': GEEKMIDAS_VERSIONS['@geekmidas/logger'],
		'@geekmidas/rate-limit': GEEKMIDAS_VERSIONS['@geekmidas/rate-limit'],
		'@geekmidas/schema': GEEKMIDAS_VERSIONS['@geekmidas/schema'],
		'@hono/node-server': '~1.14.1',
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

			// src/events/publisher.ts
			{
				path: 'src/events/publisher.ts',
				content: `import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { Publisher, type EventPublisher } from '@geekmidas/events';
import type { AppEvents } from './types.js';

export const eventsPublisherService = {
  serviceName: 'events' as const,
  async register({ envParser, context }: ServiceRegisterOptions) {
    const logger = context.getLogger();
    logger.info('Connecting to message broker');

    const config = envParser
      .create((get) => ({
        url: get('RABBITMQ_URL').string().default('amqp://localhost:5672'),
      }))
      .parse();

    const publisher = await Publisher.fromConnectionString<AppEvents>(
      \`rabbitmq://\${config.url.replace('amqp://', '')}?exchange=events\`
    );

    logger.info('Message broker connection established');
    return publisher;
  },
} satisfies Service<'events', EventPublisher<AppEvents>>;
`,
			},

			// src/subscribers/user-events.ts
			{
				path: 'src/subscribers/user-events.ts',
				content: `import { s } from '@geekmidas/constructs/subscribers';
import { eventsPublisherService } from '../events/publisher.js';

export const userEventsSubscriber = s
  .publisher(eventsPublisherService)
  .subscribe(['user.created', 'user.updated'])
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
export const cleanupCron = cron('0 0 * * *')
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
