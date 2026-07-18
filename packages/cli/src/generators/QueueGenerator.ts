import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Queue } from '@geekmidas/constructs/queue';
import type { BuildContext } from '../build/types';
import type { QueueInfo } from '../types';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';

/**
 * Generates the runtime for `q` queue workers.
 *
 * - **server** (`gkm dev`): a single `queues.ts` exposing `setupQueues()` that
 *   runs an in-process pg-boss poller alongside the Hono server — no SQS/Lambda.
 *   Each queue subscribes by its **name** on the shared event connection.
 * - **aws-lambda**: one handler file per queue wrapping `AWSLambdaQueue`, backed
 *   by an SQS event-source mapping.
 */
export class QueueGenerator extends ConstructGenerator<
	Queue<any, any, any, any>,
	QueueInfo[]
> {
	isConstruct(value: any): value is Queue<any, any, any, any> {
		return Queue.isQueue(value);
	}

	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<Queue<any, any, any, any>>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<QueueInfo[]> {
		const provider = options?.provider || 'aws-lambda';
		const logger = console;
		const queueInfos: QueueInfo[] = [];

		if (provider === 'server') {
			// Generate queues.ts for in-process polling (even if empty, so the
			// server entry can always import setupQueues).
			await this.generateServerQueuesFile(outputDir, constructs);
			logger.log(
				`Generated server queues file with ${constructs.length} queues (polling mode)`,
			);
			return queueInfos;
		}

		if (constructs.length === 0 || provider !== 'aws-lambda') {
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
			);

			queueInfos.push({
				name: construct.name,
				handler: relative(process.cwd(), handlerFile).replace(
					/\.ts$/,
					'.handler',
				),
				batchSize: construct.batchSize,
				fifo: construct.fifo,
				timeout: construct.timeout,
				environment: await construct.getEnvironment({
					markOptional: context.markOptional,
				}),
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
	): Promise<string> {
		const handlerPath = join(outputDir, `${exportName}.ts`);
		const importPath = relative(dirname(handlerPath), sourceFile).replace(
			/\.ts$/,
			'.js',
		);
		const relativeEnvParserPath = relative(
			dirname(handlerPath),
			context.envParserPath,
		);

		const content = `import { AWSLambdaQueue } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
import ${context.envParserImportPattern} from '${relativeEnvParserPath}';

const adapter = new AWSLambdaQueue(envParser, ${exportName});

export const handler = adapter.handler;
`;

		await writeFile(handlerPath, content);
		return handlerPath;
	}

	private async generateServerQueuesFile(
		outputDir: string,
		queues: GeneratedConstruct<Queue<any, any, any, any>>[],
	): Promise<string> {
		await mkdir(outputDir, { recursive: true });

		const queuesPath = join(outputDir, 'queues.ts');

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

		const allExportNames = queues.map(({ key }) => key);

		const content = `/**
 * Generated queue workers setup
 *
 * ⚠️  WARNING: This is for LOCAL DEVELOPMENT ONLY
 * This runs an in-process pg-boss poller alongside the HTTP server. Each queue
 * subscribes by its name on the shared event connection
 * (EVENT_SUBSCRIBER_CONNECTION_STRING), so producers using
 * <NAME>_PUBLISHER_CONNECTION_STRING (pgboss:// locally) reach it.
 *
 * For production, queues run as AWS Lambda with SQS event-source mappings.
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { EventConnectionFactory, Subscriber } from '@geekmidas/events';
import type { EventConnection, EventSubscriber } from '@geekmidas/events';
import { ServiceDiscovery } from '@geekmidas/services';
${imports}

const queues = [
  ${allExportNames.join(',\n  ')}
];

const activeSubscribers: EventSubscriber<any>[] = [];

export async function setupQueues(
  envParser: EnvironmentParser<any>,
  logger: Logger,
): Promise<void> {
  if (queues.length === 0) {
    return;
  }

  logger.info('Setting up queue workers in polling mode (local development)');

  const config = envParser.create((get) => ({
    connectionString: get('EVENT_SUBSCRIBER_CONNECTION_STRING').string(),
  })).parse();

  const serviceDiscovery = ServiceDiscovery.getInstance(envParser);

  let connection: EventConnection;
  try {
    connection = await EventConnectionFactory.fromConnectionString(config.connectionString);
    const connectionType = new URL(config.connectionString).protocol.replace(':', '');
    logger.info({ connectionType }, 'Created shared event connection for queues');
  } catch (error) {
    logger.error({ error }, 'Failed to create event connection for queues');
    return;
  }

  for (const queue of queues) {
    try {
      const eventSubscriber = await Subscriber.fromConnection(connection);

      const services = queue.services.length > 0
        ? await serviceDiscovery.register(queue.services)
        : {};

      // A queue subscribes to a single "type" — its own name.
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
          });

          logger.debug({ queue: queue.name }, 'Successfully processed queue message');
        } catch (error) {
          logger.error({ error, queue: queue.name }, 'Failed to process queue message');
          // Message will become visible again for retry.
        }
      });

      activeSubscribers.push(eventSubscriber);
      logger.info({ queue: queue.name }, 'Queue worker started polling');
    } catch (error) {
      logger.error({ error, queue: queue.name }, 'Failed to setup queue worker');
    }
  }

  const shutdown = () => {
    logger.info('Stopping all queue workers');
    for (const _ of activeSubscribers) {
      connection.stop();
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
`;

		await writeFile(queuesPath, content);
		return queuesPath;
	}
}
