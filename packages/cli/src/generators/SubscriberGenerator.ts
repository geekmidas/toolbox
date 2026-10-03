import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Subscriber } from '@geekmidas/constructs/subscribers';
import { canonicalId, provideKey } from '@geekmidas/manifest';
import type { BuildContext } from '../build/types';
import type { SubscriberInfo } from '../types';
import { runtimeFor } from './EndpointGenerator.js';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';

export class SubscriberGenerator extends ConstructGenerator<
	Subscriber<any, any, any, any, any>,
	SubscriberInfo[]
> {
	isConstruct(value: any): value is Subscriber<any, any, any, any, any> {
		return Subscriber.isSubscriber(value);
	}

	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<Subscriber<any, any, any, any, any>>[],
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
				construct.owner,
			);

			subscriberInfos.push({
				name: key,
				handler: relative(process.cwd(), handlerFile).replace(
					/\.ts$/,
					'.handler',
				),
				subscribedEvents: construct.subscribedEvents || [],
				// A subscriber bound to a topic (via `s.topic(topic)`) records the
				// binding so infra wires the SNS subscription.
				...(construct.topicName
					? { transport: 'topic' as const, topic: construct.topicName }
					: {}),
				timeout: construct.timeout,
				memorySize: construct.memorySize,
				environment: await construct.getEnvironment({
					markOptional: context.markOptional,
				}),
				dependencies: construct.constructs,
			});

			logger.log(`Generated subscriber handler: ${key}`);
		}

		return subscriberInfos;
	}

	private async generateSubscriberHandler(
		outputDir: string,
		sourceFile: string,
		exportName: string,
		_subscriber: Subscriber<any, any, any, any, any>,
		context: BuildContext,
		/** The construct that owns this — its worker, or its surface. */
		owner: string | undefined,
	): Promise<string> {
		const handlerFileName = `${exportName}.ts`;
		const handlerPath = join(outputDir, handlerFileName);

		const relativePath = relative(dirname(handlerPath), sourceFile);
		const importPath = relativePath.replace(/\.ts$/, '.js');

		// Imports the construct that owns this, and binds `envParser` and
		// `logger` off it — the objects it was declared with, rather than a
		// module path printed in from config.
		const runtime = runtimeFor(context, dirname(handlerPath), owner);

		const content = `import { AWSLambdaSubscriber } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
${runtime.imports}
${runtime.bindings}

const adapter = new AWSLambdaSubscriber(envParser, ${exportName});

export const handler = adapter.handler;
`;

		await writeFile(handlerPath, content);
		return handlerPath;
	}

	private async generateServerSubscribersFile(
		outputDir: string,
		subscribers: GeneratedConstruct<Subscriber<any, any, any, any, any>>[],
	): Promise<string> {
		await mkdir(outputDir, { recursive: true });
		const subscribersPath = join(outputDir, 'subscribers.ts');

		// Nothing to run, so nothing to import. Every app gets this file, and
		// `@geekmidas/events` is only installed by one that declared a Topic or
		// a Queue — importing it here crashed every dev server that had not.
		if (subscribers.length === 0) {
			await writeFile(
				subscribersPath,
				`/**
 * Generated subscribers setup — this app declares none.
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';

export async function setupSubscribers(
  _app: unknown,
  _envParser: EnvironmentParser<any>,
  _logger: Logger,
): Promise<(port: number) => Promise<void>> {
  return async () => {};
}
`,
			);
			return subscribersPath;
		}

		const importsByFile = new Map<string, string[]>();
		for (const { path, key } of subscribers) {
			const importPath = relative(
				dirname(subscribersPath),
				path.relative,
			).replace(/\.ts$/, '.js');
			importsByFile.set(importPath, [
				...(importsByFile.get(importPath) ?? []),
				key,
			]);
		}
		const imports = Array.from(importsByFile.entries())
			.map(
				([importPath, exports]) =>
					`import { ${exports.join(', ')} } from '${importPath}';`,
			)
			.join('\n');

		// Each subscriber reaches the topic it is bound to, by that topic's own
		// key — resolved here, at build time, from the binding.
		const entries = subscribers
			.map(({ key, construct }) => {
				const connectionKey = construct.topicName
					? provideKey(
							canonicalId(construct.topicName),
							'publisherConnectionString',
						)
					: undefined;
				return `  { id: '${key}', subscriber: ${key}, topic: ${
					construct.topicName ? `'${construct.topicName}'` : 'undefined'
				}, connectionKey: ${
					connectionKey ? `'${connectionKey}'` : 'undefined'
				} },`;
			})
			.join('\n');

		const content = `/**
 * Generated subscribers setup.
 *
 * Each subscriber is run against the topic it is bound to, through that
 * topic's own connection string:
 *
 * - **sns://** — pushed, not polled. The subscriber gets an HTTP route on this
 *   server, and the route is subscribed to the topic with a filter policy of
 *   the events it named, so SNS fans out to each subscriber. The route runs the
 *   subscriber through the same adaptor a Lambda subscription does.
 * - **anything else** (pgboss://, rabbitmq://, sqs://) — polled. On pg-boss
 *   each subscriber drains a queue of its own, \`<topic>/<subscriber>\`, so
 *   every subscriber sees every event; replicas of one subscriber share it.
 *
 * GKM_SUBSCRIBERS=off (\`gkm dev --no-subscribers\`) runs none of them.
 * GKM_SUBSCRIBER_PUSH_URL is the address SNS pushes to; against the local
 * emulator it defaults to this server through host.docker.internal.
 */
import { connect } from 'node:net';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { EventConnectionFactory, Subscriber } from '@geekmidas/events';
import type { EventConnection } from '@geekmidas/events';
import { ServiceDiscovery } from '@geekmidas/services';
${imports}

const subscribers = [
${entries}
];

/** The route a subscriber's pushes arrive on. */
export const SUBSCRIBER_ROUTE = (id: string) => \`/__gkm/subscribers/\${id}\`;

/** Resolves once something is accepting connections on the port. */
async function listening(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.end(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Mount each pushed subscriber's route and start each polled one. Returns what
 * to run once the server is listening: subscribing a route makes SNS send its
 * confirmation at once, so the route has to be reachable first.
 */
export async function setupSubscribers(
  app: { post: (path: string, handler: (c: any) => unknown) => unknown },
  envParser: EnvironmentParser<any>,
  logger: Logger,
): Promise<(port: number) => Promise<void>> {
  if (process.env.GKM_SUBSCRIBERS === 'off') {
    logger.info('Subscribers are off (--no-subscribers)');
    return async () => {};
  }

  const serviceDiscovery = ServiceDiscovery.getInstance(envParser);
  const connections = new Map<string, EventConnection>();
  const afterListening: ((port: number) => Promise<void>)[] = [];

  for (const { id, subscriber, topic, connectionKey } of subscribers) {
    const events = subscriber.subscribedEvents || [];
    if (events.length === 0) {
      logger.warn({ subscriber: id }, 'Subscriber has no subscribed events, skipping');
      continue;
    }
    const connectionString = connectionKey ? process.env[connectionKey] : undefined;
    if (!connectionString) {
      logger.error(
        { subscriber: id, connectionKey },
        'No connection string for the topic this subscriber is bound to',
      );
      continue;
    }

    try {
      if (connectionString.startsWith('sns:')) {
        const { SNSConnection, snsUrl, subscribeHttpEndpoint } = await import('@geekmidas/events/sns');
        const { SnsPushSubscriberAdaptor } = await import('@geekmidas/constructs/aws');
        const address = snsUrl.parse(connectionString);
        const route = SUBSCRIBER_ROUTE(id);
        const adaptor = new SnsPushSubscriberAdaptor(envParser, subscriber, {
          topicArn: address.topicArn,
          // An emulator signs nothing. Decided by the address this server was
          // configured with, never by anything a request says about itself.
          verify: !address.endpoint,
          ...(address.endpoint ? { emulatorEndpoint: address.endpoint } : {}),
        });

        app.post(route, async (c: any) => {
          const body = JSON.parse(await c.req.text());
          const response = await adaptor.handle(body);
          return c.json(response.body, response.status);
        });

        afterListening.push(async (port) => {
          const base =
            process.env.GKM_SUBSCRIBER_PUSH_URL ??
            (address.endpoint ? \`http://host.docker.internal:\${port}\` : undefined);
          if (!base) {
            logger.error(
              { subscriber: id },
              'Set GKM_SUBSCRIBER_PUSH_URL to the public URL of this worker, which SNS pushes to',
            );
            return;
          }
          const connection = await SNSConnection.fromConnectionString(connectionString);
          await subscribeHttpEndpoint(connection, {
            endpoint: new URL(route, base).toString(),
            events,
          });
          logger.info({ subscriber: id, events }, 'Subscriber subscribed for push');
        });
        continue;
      }

      let connection = connections.get(connectionString);
      if (!connection) {
        connection = await EventConnectionFactory.fromConnectionString(connectionString);
        connections.set(connectionString, connection);
      }
      // Named, so a broker with one address for everything (pg-boss) gives
      // this subscriber a queue of its own: fan-out, not competition.
      const eventSubscriber = await Subscriber.fromConnection(connection, {
        topic,
        subscription: id,
      });
      const services = subscriber.services.length > 0
        ? await serviceDiscovery.register(subscriber.services)
        : {};

      await eventSubscriber.subscribe(events, async (event) => {
        try {
          await subscriber.handler({
            events: [event],
            services: services as any,
            logger: subscriber.logger,
          });
        } catch (error) {
          logger.error({ error, event, subscriber: id }, 'Failed to process event');
          // Rethrown so the transport keeps the event for a retry — as a queue
          // consumer's failure does, and as a pushed subscriber's 500 does.
          throw error;
        }
      });
      logger.info({ subscriber: id, events }, 'Subscriber started polling');
    } catch (error) {
      logger.error({ error, subscriber: id }, 'Failed to set up subscriber');
    }
  }

  const shutdown = () => {
    for (const connection of connections.values()) void connection.close();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return async (port) => {
    if (afterListening.length === 0) return;
    await listening(port);
    for (const subscribe of afterListening) {
      await subscribe(port).catch((error) => {
        logger.error({ error }, 'Failed to subscribe for push');
      });
    }
  };
}
`;

		await writeFile(subscribersPath, content);
		return subscribersPath;
	}
}
