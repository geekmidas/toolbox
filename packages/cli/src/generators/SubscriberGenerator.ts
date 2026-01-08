import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Subscriber } from '@geekmidas/constructs/subscribers';
import type { BuildContext } from '../build/types';
import type { SubscriberInfo } from '../types';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';

export class SubscriberGenerator extends ConstructGenerator<
	Subscriber<any, any, any, any, any, any>,
	SubscriberInfo[]
> {
	isConstruct(value: any): value is Subscriber<any, any, any, any, any, any> {
		return Subscriber.isSubscriber(value);
	}

	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<Subscriber<any, any, any, any, any, any>>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<SubscriberInfo[]> {
		const provider = options?.provider || 'aws-lambda';
		const logger = console;
		const subscriberInfos: SubscriberInfo[] = [];

		if (provider === 'server') {
			// Generate subscribers.ts for server-based polling (even if empty)
			await this.generateServerSubscribersFile(outputDir, constructs);

			logger.log(
				`Generated server subscribers file with ${constructs.length} subscribers (polling mode)`,
			);

			// Return empty array as server subscribers don't have individual handlers
			return subscriberInfos;
		}

		if (constructs.length === 0) {
			return subscriberInfos;
		}

		if (provider !== 'aws-lambda') {
			return subscriberInfos;
		}

		// Create subscribers subdirectory
		const subscribersDir = join(outputDir, 'subscribers');
		await mkdir(subscribersDir, { recursive: true });

		// Generate subscriber handlers
		for (const { key, construct, path } of constructs) {
			const handlerFile = await this.generateSubscriberHandler(
				subscribersDir,
				path.relative,
				key,
				construct,
				context,
			);

			subscriberInfos.push({
				name: key,
				handler: relative(process.cwd(), handlerFile).replace(
					/\.ts$/,
					'.handler',
				),
				subscribedEvents: construct.subscribedEvents || [],
				timeout: construct.timeout,
				memorySize: construct.memorySize,
				environment: await construct.getEnvironment(),
			});

			logger.log(`Generated subscriber handler: ${key}`);
		}

		return subscriberInfos;
	}

	private async generateSubscriberHandler(
		outputDir: string,
		sourceFile: string,
		exportName: string,
		_subscriber: Subscriber<any, any, any, any, any, any>,
		context: BuildContext,
	): Promise<string> {
		const handlerFileName = `${exportName}.ts`;
		const handlerPath = join(outputDir, handlerFileName);

		const relativePath = relative(dirname(handlerPath), sourceFile);
		const importPath = relativePath.replace(/\.ts$/, '.js');

		const relativeEnvParserPath = relative(
			dirname(handlerPath),
			context.envParserPath,
		);

		const content = `import { AWSLambdaSubscriber } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
import ${context.envParserImportPattern} from '${relativeEnvParserPath}';

const adapter = new AWSLambdaSubscriber(envParser, ${exportName});

export const handler = adapter.handler;
`;

		await writeFile(handlerPath, content);
		return handlerPath;
	}

	private async generateServerSubscribersFile(
		outputDir: string,
		subscribers: GeneratedConstruct<Subscriber<any, any, any, any, any, any>>[],
	): Promise<string> {
		// Ensure output directory exists
		await mkdir(outputDir, { recursive: true });

		const subscribersFileName = 'subscribers.ts';
		const subscribersPath = join(outputDir, subscribersFileName);

		// Group imports by file
		const importsByFile = new Map<string, string[]>();

		for (const { path, key } of subscribers) {
			const relativePath = relative(dirname(subscribersPath), path.relative);
			const importPath = relativePath.replace(/\.ts$/, '.js');

			if (!importsByFile.has(importPath)) {
				importsByFile.set(importPath, []);
			}
			importsByFile.get(importPath)!.push(key);
		}

		// Generate import statements
		const imports = Array.from(importsByFile.entries())
			.map(
				([importPath, exports]) =>
					`import { ${exports.join(', ')} } from '${importPath}';`,
			)
			.join('\n');

		const allExportNames = subscribers.map(({ key }) => key);

		const content = `/**
 * Generated subscribers setup
 *
 * ⚠️  WARNING: This is for LOCAL DEVELOPMENT ONLY
 * This uses event polling which is not suitable for production.
 *
 * For production, use AWS Lambda with SQS/SNS event source mappings.
 * Lambda automatically:
 * - Scales based on queue depth
 * - Handles batch processing and retries
 * - Manages dead letter queues
 * - Provides better cost optimization
 *
 * This polling implementation is useful for:
 * - Local development and testing
 * - Understanding event flow without Lambda deployment
 *
 * Supported connection strings:
 * - sqs://region/account-id/queue-name (SQS queue)
 * - sns://region/account-id/topic-name (SNS topic)
 * - rabbitmq://host:port/queue-name (RabbitMQ)
 * - basic://in-memory (In-memory for testing)
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { EventConnectionFactory, Subscriber } from '@geekmidas/events';
import type { EventConnection, EventSubscriber } from '@geekmidas/events';
import { ServiceDiscovery } from '@geekmidas/services';
${imports}

const subscribers = [
  ${allExportNames.join(',\n  ')}
];

const activeSubscribers: EventSubscriber<any>[] = [];

export async function setupSubscribers(
  envParser: EnvironmentParser<any>,
  logger: Logger,
): Promise<void> {
  logger.info('Setting up subscribers in polling mode (local development)');

  const config = envParser.create((get) => ({
    connectionString: get('EVENT_SUBSCRIBER_CONNECTION_STRING').string().optional(),
  })).parse();

  if (!config.connectionString) {
    logger.warn('EVENT_SUBSCRIBER_CONNECTION_STRING not configured, skipping subscriber setup');
    return;
  }

  const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);

  // Create connection once, outside the loop (more efficient)
  // EventConnectionFactory automatically determines the right connection type
  let connection: EventConnection;
  try {
    connection = await EventConnectionFactory.fromConnectionString(config.connectionString);

    const connectionType = new URL(config.connectionString).protocol.replace(':', '');
    logger.info({ connectionType }, 'Created shared event connection');
  } catch (error) {
    logger.error({ error }, 'Failed to create event connection');
    return;
  }

  for (const subscriber of subscribers) {
    try {
      // Create subscriber from shared connection
      const eventSubscriber = await Subscriber.fromConnection(connection);

      // Register services
      const services = subscriber.services.length > 0
        ? await serviceDiscovery.register(subscriber.services)
        : {};

      // Subscribe to events
      const subscribedEvents = subscriber.subscribedEvents || [];

      if (subscribedEvents.length === 0) {
        logger.warn({ subscriber: subscriber.constructor.name }, 'Subscriber has no subscribed events, skipping');
        continue;
      }

      await eventSubscriber.subscribe(subscribedEvents, async (event) => {
        try {
          // Process single event (batch of 1)
          await subscriber.handler({
            events: [event],
            services: services as any,
            logger: subscriber.logger,
          });

          logger.debug({ eventType: event.type }, 'Successfully processed event');
        } catch (error) {
          logger.error({ error, event }, 'Failed to process event');
          // Event will become visible again for retry
        }
      });

      activeSubscribers.push(eventSubscriber);

      logger.info(
        {
          events: subscribedEvents,
        },
        'Subscriber started polling'
      );
    } catch (error) {
      logger.error({ error, subscriber: subscriber.constructor.name }, 'Failed to setup subscriber');
    }
  }

  // Setup graceful shutdown
  const shutdown = () => {
    logger.info('Stopping all subscribers');
    for (const eventSubscriber of activeSubscribers) {
      connection.stop();
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
`;

		await writeFile(subscribersPath, content);
		return subscribersPath;
	}
}
