import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Subscriber } from '@geekmidas/constructs/subscribers';
import { canonicalId } from '@geekmidas/manifest';
import type { BuildContext } from '../build/types';
import {
	subscriberConnectionKey,
	subscriberTokenKey,
} from '../reconcile/edges.js';
import type { SubscriberInfo } from '../types';
import { runtimeFor } from './EndpointGenerator.js';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';
import {
	OBJECTS_ROUTE_PREFIX,
	SNS_SUBSCRIPTIONS_KEY,
	SUBSCRIBER_ROUTE_PREFIX,
} from './subscriberRoute.js';

export class SubscriberGenerator extends ConstructGenerator<
	Subscriber<any, any, any, any, any, any, any>,
	SubscriberInfo[]
> {
	isConstruct(
		value: any,
	): value is Subscriber<any, any, any, any, any, any, any> {
		return Subscriber.isSubscriber(value);
	}

	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<
			Subscriber<any, any, any, any, any, any, any>
		>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<SubscriberInfo[]> {
		const target = options?.target ?? 'aws';
		const logger = console;
		const subscriberInfos: SubscriberInfo[] = [];

		for (const { key, construct } of constructs) {
			assertDoesNotFeedItself(key, construct);
		}

		if (target === 'server') {
			// Generate subscribers.ts for server-based polling (even if empty).
			// A bucket's subscriber is pushed to by the topic the storage
			// publishes to, whatever broker carries the app's own events.
			await this.generateServerSubscribersFile(
				outputDir,
				constructs,
				(context.eventsBackends?.includes('sns') ?? false) ||
					constructs.some(({ construct }) => construct.bucketName),
			);

			logger.log(
				`Generated server subscribers file with ${constructs.length} subscribers (polling mode)`,
			);

			// Return empty array as server subscribers don't have individual handlers
			return subscriberInfos;
		}

		if (constructs.length === 0) {
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
				handler: relative(options?.root ?? process.cwd(), handlerFile).replace(
					/\.ts$/,
					'.handler',
				),
				subscribedEvents: construct.subscribedEvents || [],
				// A subscriber bound to a topic (via `s.topic(topic)`) records the
				// binding so infra wires the SNS subscription.
				...(construct.topicName
					? { transport: 'topic' as const, topic: construct.topicName }
					: {}),
				// A subscriber bound to a bucket records it, and the keys it
				// watches, so infra wires the bucket's notifications.
				...(construct.bucketName
					? {
							transport: 'topic' as const,
							bucket: construct.bucketName,
							...construct.objectFilter,
						}
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
		_subscriber: Subscriber<any, any, any, any, any, any, any>,
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
${context.storageDrivers?.imports ?? ''}
${runtime.bindings}
${context.storageDrivers?.setup ? `\n// The handler registers the drivers its target needs.\n${context.storageDrivers.setup}\n` : ''}
const adapter = new AWSLambdaSubscriber(envParser, ${exportName});

export const handler = adapter.handler;
`;

		await writeFile(handlerPath, content);
		return handlerPath;
	}

	private async generateServerSubscribersFile(
		outputDir: string,
		subscribers: GeneratedConstruct<
			Subscriber<any, any, any, any, any, any, any>
		>[],
		/**
		 * The broker is SNS, so a subscriber is pushed to over HTTP. Only then is
		 * the push code generated: it imports the SNS client, which a bundle for
		 * any other broker must never have to resolve.
		 */
		push: boolean,
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

export function subscribersStatus(): { failed: string[]; connections: unknown[] } {
  return { failed: [], connections: [] };
}

export async function stopSubscribers(): Promise<void> {}
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
		// key — resolved here, at build time, from the binding. A bucket's
		// subscriber reaches the bucket's events, which carry no `type`
		// attribute for SNS to filter on: it filters what it is sent itself.
		const entries = subscribers
			.map(({ key, construct }) => {
				const connectionKey = subscriberConnectionKey(construct);
				const tokenKey = subscriberTokenKey(construct);
				const topic = construct.topicName ?? construct.bucketName;
				const bucket = construct.bucketName
					? canonicalId(construct.bucketName)
					: undefined;
				return `  { id: '${key}', subscriber: ${key}, topic: ${
					topic ? `'${topic}'` : 'undefined'
				}, connectionKey: ${
					connectionKey ? `'${connectionKey}'` : 'undefined'
				}, filtered: ${construct.bucketName ? 'false' : 'true'}, bucket: ${
					bucket ? `'${bucket}'` : 'undefined'
				}, tokenKey: ${tokenKey ? `'${tokenKey}'` : 'undefined'} },`;
			})
			.join('\n');

		const content = `/**
 * Generated subscribers setup.
 *
 * Each subscriber is run against the topic it is bound to, through that
 * topic's own connection string:
 *
 * - **sns://** — pushed, not polled. The subscriber gets an HTTP route on this
 *   server, subscribed to the topic with a filter policy of the events it
 *   named, so SNS fans out to each subscriber. The route runs the subscriber
 *   through the same adaptor a Lambda subscription does. Against SNS itself
 *   the deploy made the subscription and recorded its ARN in
 *   ${SNS_SUBSCRIPTIONS_KEY}: a route is mounted only for a recorded one, its
 *   confirmation goes through the API, and nothing is subscribed from here.
 *   Against an emulator, where nothing deploys, the route subscribes itself.
 * - **anything else** (pgboss://, rabbitmq://, sqs://) — polled. On pg-boss
 *   each subscriber drains a queue of its own, \`<topic>/<subscriber>\`, so
 *   every subscriber sees every event; replicas of one subscriber share it.
 *
 * A bucket's subscriber is polled the same way, under the bucket's name, when
 * the bucket is in a local object store: the store posts each event to
 * \`${OBJECTS_ROUTE_PREFIX}<Bucket>\` on this server, with the bucket's token, and
 * the event is relayed onto the broker as \`object.created\` or
 * \`object.deleted\` — so every subscriber of the bucket sees it.
 *
 * GKM_SUBSCRIBERS=off (\`gkm dev --no-subscribers\`) runs none of them.
 * GKM_SUBSCRIBER_PUSH_URL is the address an emulator pushes to, defaulting to
 * this server through host.docker.internal.
 */
import { timingSafeEqual } from 'node:crypto';
import { connect } from 'node:net';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { EventConnectionFactory, Publisher, Subscriber } from '@geekmidas/events';
import type { EventConnection } from '@geekmidas/events';
import { ServiceDiscovery } from '@geekmidas/services';
${imports}

const subscribers = [
${entries}
];

// What was opened, and what could not be: a worker's health check reads both,
// and its shutdown closes what was opened.
const connections = new Map<string, EventConnection>();
const failed: string[] = [];

/**
 * The subscriptions the deploy made against SNS itself, by subscriber: which
 * routes to mount, and the ARN each one's notifications must name.
 */
function recordedSubscriptions(logger: Logger): Record<string, string> {
  const raw = process.env.${SNS_SUBSCRIPTIONS_KEY};
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  logger.error('${SNS_SUBSCRIPTIONS_KEY} is not a JSON object of subscriber → subscription ARN');
  return {};
}

/** The route a subscriber's pushes arrive on. */
export const SUBSCRIBER_ROUTE = (id: string) => \`${SUBSCRIBER_ROUTE_PREFIX}\${id}\`;

/** The route a local object store posts a bucket's events to. */
export const OBJECTS_ROUTE = (bucket: string) => \`${OBJECTS_ROUTE_PREFIX}\${bucket}\`;

// The buckets whose events this server relays: one route each, however many
// subscribers watch the bucket.
const relays = new Set<string>();

/**
 * Mount the route a local object store posts one bucket's events to, and
 * relay each event onto the broker under the bucket's name.
 *
 * Answered 2xx only once every event is published: the store keeps what it
 * was not told it delivered, and sends it again.
 */
async function mountObjectRelay(
  app: { post: (path: string, handler: (c: any) => unknown) => unknown },
  relay: { bucket: string; topic: string; connection: EventConnection; tokenKey: string },
  logger: Logger,
): Promise<void> {
  const token = process.env[relay.tokenKey];
  if (!token) {
    logger.error(
      { bucket: relay.bucket, tokenKey: relay.tokenKey },
      'No token for this bucket: the events its object store posts cannot be received',
    );
    failed.push(\`\${relay.bucket}#events\`);
    return;
  }
  const { toObjectEvents } = await import('@geekmidas/storage/events');
  const publisher = await Publisher.fromConnection(relay.connection, { topic: relay.topic });
  const expected = Buffer.from(\`Bearer \${token}\`);

  app.post(OBJECTS_ROUTE(relay.bucket), async (c: any) => {
    // Compared in constant time: the route is not public, but it is the one
    // way to put an event in front of every subscriber of the bucket.
    const given = Buffer.from(c.req.header('authorization') ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return c.json({ status: 'refused' }, 401);
    }

    let messages: Awaited<ReturnType<typeof toObjectEvents>>;
    try {
      messages = toObjectEvents(JSON.parse(await c.req.text()));
    } catch (error) {
      logger.warn({ err: error, bucket: relay.bucket }, 'Refused an object notification that did not parse');
      return c.json({ status: 'malformed' }, 400);
    }

    try {
      if (messages.length > 0) await publisher.publish(messages as any);
    } catch (error) {
      // The store sends it again.
      logger.error({ err: error, bucket: relay.bucket }, 'Failed to relay object events');
      return c.json({ status: 'failed' }, 500);
    }
    return c.json({ status: 'ok', relayed: messages.length }, 200);
  });
  logger.info({ bucket: relay.bucket }, 'Relaying object events');
}

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
  const recorded = recordedSubscriptions(logger);
  const afterListening: ((port: number) => Promise<void>)[] = [];

  for (const { id, subscriber, topic, connectionKey, filtered, bucket, tokenKey } of subscribers) {
    const events = subscriber.subscribedEvents || [];
    if (events.length === 0) {
      logger.warn({ subscriber: id }, 'Subscriber has no subscribed events, skipping');
      continue;
    }
    const connectionString = connectionKey ? process.env[connectionKey] : undefined;
    if (!connectionString) {
      logger.error(
        { subscriber: id, connectionKey },
        'No connection string for the topic or bucket this subscriber is bound to',
      );
      failed.push(id);
      continue;
    }

    try {
${
	push
		? `      if (connectionString.startsWith('sns:')) {
        const { SNSConnection, snsUrl, subscribeHttpEndpoint, confirmSubscription } = await import('@geekmidas/events/sns');
        const { SnsPushSubscriberAdaptor } = await import('@geekmidas/constructs/subscribers');
        const address = snsUrl.parse(connectionString);
        const route = SUBSCRIBER_ROUTE(id);
        const mount = (adaptor: InstanceType<typeof SnsPushSubscriberAdaptor>) =>
          app.post(route, async (c: any) => {
            const body = JSON.parse(await c.req.text());
            const response = await adaptor.handle(body, {
              subscriptionArn: c.req.header('x-amz-sns-subscription-arn'),
            });
            return c.json(response.body, response.status);
          });

        if (!address.endpoint) {
          // SNS itself: the deploy subscribed this route and recorded the ARN.
          // Nothing is subscribed from here, so this server's credentials need
          // only sns:ConfirmSubscription on the topic.
          const subscriptionArn = recorded[id];
          if (!subscriptionArn) {
            logger.error(
              { subscriber: id },
              'No subscription recorded for this subscriber in ${SNS_SUBSCRIPTIONS_KEY}: deploy it so SNS has a route to push to',
            );
            failed.push(id);
            continue;
          }
          const connection = await SNSConnection.fromConnectionString(connectionString);
          mount(
            new SnsPushSubscriberAdaptor(envParser, subscriber, {
              topicArn: address.topicArn,
              verify: true,
              subscriptionArn,
              // As the topic's owner, so only the owner can unsubscribe the
              // route — not whoever holds a notification's UnsubscribeURL.
              confirm: (message) => confirmSubscription(connection, message),
            }),
          );
          logger.info({ subscriber: id, events }, 'Subscriber mounted for push');
          continue;
        }

        // An emulator signs nothing, and nothing deploys its subscriptions:
        // decided by the address this server was configured with, never by
        // anything a request says about itself.
        mount(
          new SnsPushSubscriberAdaptor(envParser, subscriber, {
            topicArn: address.topicArn,
            verify: false,
            emulatorEndpoint: address.endpoint,
          }),
        );

        afterListening.push(async (port) => {
          const base =
            process.env.GKM_SUBSCRIBER_PUSH_URL ?? \`http://host.docker.internal:\${port}\`;
          const connection = await SNSConnection.fromConnectionString(connectionString);
          await subscribeHttpEndpoint(connection, {
            endpoint: new URL(route, base).toString(),
            ...(filtered ? { events } : {}),
          });
          logger.info({ subscriber: id, events }, 'Subscriber subscribed for push');
        });
        continue;
      }
`
		: `      if (connectionString.startsWith('sns:')) {
        // Built for a broker other than SNS, so this entry registered no SNS
        // driver and has no push route to offer.
        logger.error(
          { subscriber: id, connectionKey },
          'This build has no SNS driver: it was built for a target whose broker is not SNS',
        );
        failed.push(id);
        continue;
      }
`
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
      // The subscriber's database — the worker's, or its own — as \`db\`. A
      // pushed subscriber gets it from the adaptor above instead.
      const db = subscriber.databaseService
        ? (await serviceDiscovery.register([subscriber.databaseService]))[
            subscriber.databaseService.serviceName
          ]
        : undefined;

      await eventSubscriber.subscribe(events, async (event) => {
        try {
          await subscriber.handler({
            events: [event],
            services: services as any,
            logger: subscriber.logger,
            db,
          } as any);
        } catch (error) {
          logger.error({ err: error, event, subscriber: id }, 'Failed to process event');
          // Rethrown so the transport keeps the event for a retry — as a queue
          // consumer's failure does, and as a pushed subscriber's 500 does.
          throw error;
        }
      });
      logger.info({ subscriber: id, events }, 'Subscriber started polling');

      // A bucket in a local object store publishes nothing for this to poll:
      // the store posts its events here, and they are relayed onto the broker.
      if (bucket && tokenKey && topic && !relays.has(bucket)) {
        relays.add(bucket);
        await mountObjectRelay(app, { bucket, topic, connection, tokenKey }, logger);
      }
    } catch (error) {
      // The message too: a missing module's code alone does not say which.
      logger.error(
        { err: error, subscriber: id },
        'Failed to set up subscriber',
      );
      failed.push(id);
    }
  }

  return async (port) => {
    if (afterListening.length === 0) return;
    await listening(port);
    for (const subscribe of afterListening) {
      await subscribe(port).catch((error) => {
        logger.error({ err: error }, 'Failed to subscribe for push');
      });
    }
  };
}

/** The subscribers that could not start, and the connections that did. */
export function subscribersStatus(): { failed: string[]; connections: EventConnection[] } {
  return { failed: [...failed], connections: [...connections.values()] };
}

/**
 * Stop polling, let the events in flight finish, and close each broker
 * connection — pg-boss's graceful stop does all three. The caller bounds it.
 */
export async function stopSubscribers(): Promise<void> {
  const open = [...connections.values()];
  connections.clear();
  await Promise.all(open.map((connection) => connection.close()));
}
`;

		await writeFile(subscribersPath, content);
		return subscribersPath;
	}
}

/**
 * A bucket's subscriber that writes back into the keys it watches.
 *
 * Every write it makes is a new object event, which runs it again — forever,
 * and billed per run. The rule is the one the build can check: a subscriber
 * that depends on the bucket it watches must watch a prefix, so what it writes
 * can go elsewhere. A thumbnailer watching `uploads/` writes `thumbnails/`.
 */
export class ObjectSubscriberFeedsItself extends Error {
	constructor(
		readonly subscriber: string,
		readonly bucket: string,
	) {
		super(
			`'${subscriber}' watches every key in '${bucket}' and depends on it, ` +
				`so each object it writes runs it again. Watch a prefix — ` +
				`.on([...], { prefix: 'uploads/' }) — and write outside it.`,
		);
		this.name = 'ObjectSubscriberFeedsItself';
	}
}

function assertDoesNotFeedItself(
	key: string,
	construct: Subscriber<any, any, any, any, any, any, any>,
): void {
	const bucket = construct.bucketName;
	if (!bucket || construct.objectFilter?.prefix) return;
	const depends = (construct.constructs ?? []).some(
		(id: string) => canonicalId(id) === canonicalId(bucket),
	);
	if (depends) throw new ObjectSubscriberFeedsItself(key, bucket);
}
