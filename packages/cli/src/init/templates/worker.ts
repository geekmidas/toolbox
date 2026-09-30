import { databaseFiles } from '../constructs.js';
import { DEPENDENCY_VERSIONS, TOOLCHAIN_VERSIONS } from '../dependencies.js';
import { stageEnv } from '../generators/stages.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from './index.js';

/**
 * A project that is background work and nothing else.
 *
 * It used to scaffold a `RestApi` with no endpoints on it — an HTTP surface
 * declared by a project whose premise is that nothing calls it over HTTP —
 * because a surface was the only construct that made an app exist and the only
 * way to get a logger into the generated runtime. `Worker` is the construct
 * that was missing: it takes no authorizer, publishes no address, and hands out
 * factories already carrying its logger.
 *
 * It scaffolds a cron when the project has a database, and not otherwise. A
 * server fires its own crons, and the schedule lives in Postgres so that
 * running more than one replica still fires each job once — so a worker names
 * the database it keeps schedules in. Without one there is nowhere to keep
 * them, and an example that could not run is worse than none.
 */
export const workerTemplate: TemplateConfig = {
	name: 'worker',
	description: 'Background job processing',

	dependencies: {
		'@geekmidas/audit': GEEKMIDAS_VERSIONS['@geekmidas/audit'],
		'@geekmidas/constructs': GEEKMIDAS_VERSIONS['@geekmidas/constructs'],
		'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
		'@geekmidas/events': GEEKMIDAS_VERSIONS['@geekmidas/events'],
		'@geekmidas/logger': GEEKMIDAS_VERSIONS['@geekmidas/logger'],
		'@geekmidas/schema': GEEKMIDAS_VERSIONS['@geekmidas/schema'],
		zod: DEPENDENCY_VERSIONS.zod,
	},

	devDependencies: {
		'@biomejs/biome': DEPENDENCY_VERSIONS['@biomejs/biome'],
		'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
		'@types/node': DEPENDENCY_VERSIONS['@types/node'],
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
		const { loggerType, name } = options;
		const { database } = options.constructs;

		const loggerContent = `import { createLogger } from '@geekmidas/logger/${loggerType}';

export const logger = createLogger();
`;

		const files: GeneratedFile[] = [
			// The process this project *is*: one with no port.
			//
			// Everything built from it carries this logger, so a subscriber file
			// opens with what it subscribes to rather than with an import of a
			// logger it has to know the path to.
			{
				path: 'src/constructs/worker.ts',
				content: `import { Worker } from '@geekmidas/constructs/worker';
import { logger } from '../config/logger.ts';${database ? "\nimport { database } from './database.ts';" : ''}

export const worker = new Worker('Jobs', { logger })${database ? '.database(database)' : ''};
`,
			},

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

			// The topic this worker subscribes to. Declaring it is what puts a
			// broker in the plan — no service names one, and nothing reads a
			// broker URL by hand.
			{
				path: 'src/constructs/topics.ts',
				content: `import { t } from '@geekmidas/constructs/topic';
import { z } from 'zod';

/**
 * The \`users\` topic: pub/sub fan-out, any number of subscribers.
 *
 * The event map is the contract. It types \`users.publisher\` and every
 * subscriber that binds with \`.topic(users)\`, so an event cannot be published
 * in one shape and read in another.
 */
export const users = t.topic('users').events({
  'user.created': z.object({ userId: z.string(), email: z.email() }),
  'user.updated': z.object({
    userId: z.string(),
    changes: z.record(z.string(), z.unknown()),
  }),
});
`,
			},

			// src/subscribers/user-events.ts
			{
				path: 'src/subscribers/user-events.ts',
				content: `import { users } from '~/constructs/topics.ts';
import { worker } from '~/constructs/worker.ts';

// Bound to the topic, not handed its publisher: a subscriber consumes.
export const userEventsSubscriber = worker
  .topic(users)
  .subscribe(['user.created', 'user.updated'])
  .handle(async ({ events, logger }) => {
    // A batch, not a single event. Both transports deliver in batches, so
    // handling them one at a time is a round trip per event for no reason.
    logger.info({ count: events.length }, 'Processing user events');

    for (const event of events) {
      switch (event.type) {
        case 'user.created':
          logger.info({ userId: event.payload.userId }, 'New user created');
          break;
        case 'user.updated':
          logger.info({ userId: event.payload.userId }, 'User updated');
          break;
      }
    }
  });
`,
			},
		];

		// A cron, now that a server target runs one. The schedule lives in the
		// database the worker named; on AWS it becomes an EventBridge rule and
		// none of that is consulted.
		if (database) {
			files.push({
				path: 'src/crons/cleanup.ts',
				content: `import { worker } from '~/constructs/worker.ts';

export const cleanup = worker
  .cron('rate(1 day)')
  .handle(async ({ logger }) => {
    logger.info('Running cleanup');

    // Delete old sessions, clear temp files, whatever falls out of date.

    logger.info('Cleanup complete');
  });
`,
			});
		}

		// The database, when this project has one. A `pgboss` events backend
		// implies one, which is why a worker gets here without asking for it.
		if (options.constructs.database) {
			files.push(...databaseFiles());
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
