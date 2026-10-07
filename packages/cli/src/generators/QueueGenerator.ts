import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Queue } from '@geekmidas/constructs/queue';
import { provideKey } from '@geekmidas/manifest';
import type { BuildContext } from '../build/types';
import type { QueueInfo } from '../types';
import { runtimeFor } from './EndpointGenerator.js';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';

/**
 * Generates the runtime for queue consumers (`worker.queue(…)`).
 *
 * - **server** (`gkm dev`): a single `queues.ts` exposing `setupQueues()` that
 *   polls each queue in-process, alongside the Hono server, through the queue's
 *   own connection string — pg-boss by default, SQS on the AWS emulator.
 * - **aws-lambda**: one handler file per queue wrapping `AWSLambdaQueue`, backed
 *   by an SQS event-source mapping.
 */
export class QueueGenerator extends ConstructGenerator<
	Queue<any, any, any, any, any, any>,
	QueueInfo[]
> {
	isConstruct(value: any): value is Queue<any, any, any, any, any, any> {
		return Queue.isQueue(value);
	}

	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<Queue<any, any, any, any, any, any>>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<QueueInfo[]> {
		const target = options?.target ?? 'aws';
		const logger = console;
		const queueInfos: QueueInfo[] = [];

		if (target === 'server') {
			// Generate queues.ts for in-process polling (even if empty, so the
			// server entry can always import setupQueues).
			await this.generateServerQueuesFile(outputDir, constructs);
			logger.log(
				`Generated server queues file with ${constructs.length} queues (polling mode)`,
			);
			return queueInfos;
		}

		if (constructs.length === 0) {
			return queueInfos;
		}

		const queuesDir = join(outputDir, 'queues');
		await mkdir(queuesDir, { recursive: true });

		for (const { key, construct, path } of constructs) {
			const handlerFile = await this.generateQueueHandler(
				queuesDir,
				path.relative,
				key,
				context,
				construct.owner,
			);

			queueInfos.push({
				name: construct.name,
				handler: relative(options?.root ?? process.cwd(), handlerFile).replace(
					/\.ts$/,
					'.handler',
				),
				batchSize: construct.batchSize,
				fifo: construct.fifo,
				timeout: construct.timeout,
				environment: await construct.getEnvironment({
					markOptional: context.markOptional,
				}),
				dependencies: construct.constructs,
			});

			logger.log(`Generated queue handler: ${key}`);
		}

		return queueInfos;
	}

	private async generateQueueHandler(
		outputDir: string,
		sourceFile: string,
		exportName: string,
		context: BuildContext,
		/** The construct that owns this — its worker, or its surface. */
		owner: string | undefined,
	): Promise<string> {
		const handlerPath = join(outputDir, `${exportName}.ts`);
		const importPath = relative(dirname(handlerPath), sourceFile).replace(
			/\.ts$/,
			'.js',
		);
		// Imports the construct that owns this, and binds `envParser` and
		// `logger` off it — the objects it was declared with, rather than a
		// module path printed in from config.
		const runtime = runtimeFor(context, dirname(handlerPath), owner);

		const content = `import { AWSLambdaQueue } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
${runtime.imports}
${runtime.bindings}

const adapter = new AWSLambdaQueue(envParser, ${exportName});

export const handler = adapter.handler;
`;

		await writeFile(handlerPath, content);
		return handlerPath;
	}

	private async generateServerQueuesFile(
		outputDir: string,
		queues: GeneratedConstruct<Queue<any, any, any, any, any, any>>[],
	): Promise<string> {
		await mkdir(outputDir, { recursive: true });

		const queuesPath = join(outputDir, 'queues.ts');

		// Nothing to poll, so nothing to import. Every app gets this file, and
		// `@geekmidas/events` is only installed by one that declared a Topic or
		// a Queue — importing it here crashed every dev server that had not.
		if (queues.length === 0) {
			await writeFile(
				queuesPath,
				`/**
 * Generated queues setup — this app declares none.
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';

export async function setupQueues(
  _envParser: EnvironmentParser<any>,
  _logger: Logger,
): Promise<void> {}
`,
			);
			return queuesPath;
		}

		// Group imports by file
		const importsByFile = new Map<string, string[]>();
		for (const { path, key } of queues) {
			const importPath = relative(dirname(queuesPath), path.relative).replace(
				/\.ts$/,
				'.js',
			);
			if (!importsByFile.has(importPath)) {
				importsByFile.set(importPath, []);
			}
			importsByFile.get(importPath)?.push(key);
		}

		const imports = Array.from(importsByFile.entries())
			.map(
				([importPath, exports]) =>
					`import { ${exports.join(', ')} } from '${importPath}';`,
			)
			.join('\n');

		// Each queue's consumer reaches its own queue, by the queue's own key.
		const entries = queues
			.map(
				({ key, construct }) =>
					`  { queue: ${key}, connectionKey: '${provideKey(
						construct.id,
						'publisherConnectionString',
					)}' },`,
			)
			.join('\n');

		const content = `/**
 * Generated queue consumers setup.
 *
 * Each queue's one consumer polls its own queue, through the queue's own
 * connection string — the one its producers publish on. SQS cannot push, so
 * this is a poller on every transport: pg-boss locally by default, the SQS
 * queue on the AWS emulator.
 *
 * Deployed on Lambda, a queue's consumer is an SQS event source instead.
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { EventConnectionFactory, Subscriber } from '@geekmidas/events';
import type { EventConnection } from '@geekmidas/events';
import { ServiceDiscovery } from '@geekmidas/services';
${imports}

const queues = [
${entries}
];

export async function setupQueues(
  envParser: EnvironmentParser<any>,
  logger: Logger,
): Promise<void> {
  const serviceDiscovery = ServiceDiscovery.getInstance(envParser);
  const connections = new Map<string, EventConnection>();

  for (const { queue, connectionKey } of queues) {
    const connectionString = process.env[connectionKey];
    if (!connectionString) {
      logger.error({ queue: queue.name, connectionKey }, 'No connection string for this queue');
      continue;
    }

    try {
      let connection = connections.get(connectionString);
      if (!connection) {
        connection = await EventConnectionFactory.fromConnectionString(connectionString);
        connections.set(connectionString, connection);
      }
      const eventSubscriber = await Subscriber.fromConnection(connection);
      const services = queue.services.length > 0
        ? await serviceDiscovery.register(queue.services)
        : {};
      // The queue's database — the worker's, or its own — handed over as \`db\`.
      const db = queue.databaseService
        ? (await serviceDiscovery.register([queue.databaseService]))[
            queue.databaseService.serviceName
          ]
        : undefined;

      // A queue's messages carry one type — its own name.
      await eventSubscriber.subscribe([queue.name], async (message) => {
        try {
          const validation = await queue.messageSchema['~standard'].validate(message.payload);
          if (validation.issues) {
            logger.error({ issues: validation.issues, queue: queue.name }, 'Queue message failed validation');
            return;
          }

          await queue.handler({
            messages: [validation.value],
            services: services,
            logger: queue.logger,
            db,
          } as any);
        } catch (error) {
          logger.error({ err: error, queue: queue.name }, 'Failed to process queue message');
          // Rethrown so the transport keeps the message for a retry.
          throw error;
        }
      });
      logger.info({ queue: queue.name }, 'Queue consumer started polling');
    } catch (error) {
      logger.error({ err: error, queue: queue.name }, 'Failed to set up queue consumer');
    }
  }

  const shutdown = () => {
    for (const connection of connections.values()) void connection.close();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
`;

		await writeFile(queuesPath, content);
		return queuesPath;
	}
}
