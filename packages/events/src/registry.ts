/**
 * Events drivers, keyed by connection-string scheme.
 *
 * The same shape `@geekmidas/storage` and `@geekmidas/cache` use, for the same
 * reason: a topic or a queue is handed one connection string, and the scheme in
 * it (`pgboss://`, `sns://`, …) picks the broker. Which brokers exist is the
 * entry point's decision — a generated server registering pg-boss, a Lambda
 * registering SNS and SQS — so a bundle only ever contains the broker its
 * target uses, and never resolves the others' optional peer dependencies.
 *
 * Registration is explicit rather than an import side effect, because a
 * side-effecting module is exactly what a bundler is entitled to drop.
 */

import type { PublisherOptions } from './Publisher';
import type {
	EventConnection,
	EventPublisher,
	EventSubscriber,
	PublishableMessage,
} from './types';
import { EventPublisherType, UnsupportedEventTransport } from './types';

type AnyMessage = PublishableMessage<string, any>;

/** How a subscriber built from a connection is used, beyond its address. */
export interface SubscriberOptions {
	/**
	 * The topic subscribed to. pg-boss needs it, with {@link subscription}, to
	 * give each subscriber a queue of its own; the other brokers carry the topic
	 * in their address and ignore it.
	 */
	topic?: string;
	/** The subscriber's name — its own queue on pg-boss. */
	subscription?: string;
}

/**
 * One broker: the connections, publishers and subscribers for its scheme.
 *
 * A driver owns parsing — the shape of an `sns://` string is SNS's business —
 * and is the only module that imports its broker's client library.
 */
export interface EventsDriver {
	/**
	 * The scheme this driver handles, without the colon — `'pgboss'`, `'sns'`.
	 * It is also the `type` of every connection the driver builds, which is how
	 * a connection finds its way back here.
	 */
	readonly scheme: `${EventPublisherType}`;
	/** A connection, connected, for a connection string. */
	connect(connectionString: string): Promise<EventConnection>;
	/** A publisher, with a connection of its own, for a connection string. */
	publisher<TMessage extends AnyMessage>(
		connectionString: string,
		options: PublisherOptions,
	): Promise<EventPublisher<TMessage>>;
	/** A publisher on a connection this driver built. */
	publisherFor<TMessage extends AnyMessage>(
		connection: EventConnection,
		options: PublisherOptions,
	): EventPublisher<TMessage>;
	/** A subscriber, with a connection of its own, for a connection string. */
	subscriber<TMessage extends AnyMessage>(
		connectionString: string,
	): Promise<EventSubscriber<TMessage>>;
	/** A subscriber on a connection this driver built. */
	subscriberFor<TMessage extends AnyMessage>(
		connection: EventConnection,
		options: SubscriberOptions,
	): EventSubscriber<TMessage>;
}

/**
 * Where each built-in driver lives, so a missing one can be named exactly —
 * the subpath to import and the export to register.
 */
const BUILT_IN: Readonly<Record<string, { subpath: string; driver: string }>> =
	{
		[EventPublisherType.Basic]: {
			subpath: '@geekmidas/events/basic',
			driver: 'basicEventsDriver',
		},
		[EventPublisherType.PgBoss]: {
			subpath: '@geekmidas/events/pgboss',
			driver: 'pgbossEventsDriver',
		},
		[EventPublisherType.SNS]: {
			subpath: '@geekmidas/events/sns',
			driver: 'snsEventsDriver',
		},
		[EventPublisherType.SQS]: {
			subpath: '@geekmidas/events/sqs',
			driver: 'sqsEventsDriver',
		},
		[EventPublisherType.RabbitMQ]: {
			subpath: '@geekmidas/events/rabbitmq',
			driver: 'rabbitmqEventsDriver',
		},
	};

/**
 * The registry lives on `globalThis`, so one registration is seen by every
 * copy of this module — the ESM and the CJS build of one install, which a
 * process can load side by side, as `Credentials` already has to allow for.
 */
const REGISTRY = Symbol.for('@geekmidas/events/drivers');

function drivers(): Map<string, EventsDriver> {
	const global = globalThis as { [REGISTRY]?: Map<string, EventsDriver> };
	global[REGISTRY] ??= new Map();
	return global[REGISTRY];
}

/** Make a driver available to `Publisher`, `Subscriber` and friends. Idempotent. */
export function registerEventsDriver(driver: EventsDriver): void {
	drivers().set(driver.scheme, driver);
}

/** Which schemes are currently registered — the useful half of a failure. */
export function registeredEventsSchemes(): string[] {
	return [...drivers().keys()].sort();
}

/**
 * The driver for a scheme — `'pgboss'`, `'pgboss:'`, or a whole connection
 * string, whichever the caller has.
 *
 * @throws {UnregisteredEventsScheme} when the scheme is a broker this package
 * implements but nothing registered its driver.
 * @throws {UnsupportedEventTransport} when no broker here has that scheme.
 */
export function eventsDriverFor(
	scheme: string,
	role: 'publisher' | 'subscriber' | 'connection' = 'connection',
): EventsDriver {
	const name = schemeOf(scheme);
	const driver = drivers().get(name);
	if (driver) return driver;

	if (BUILT_IN[name]) {
		throw new UnregisteredEventsScheme(name, registeredEventsSchemes());
	}
	throw new UnsupportedEventTransport(name, role);
}

/** `pgboss` from `pgboss`, `pgboss:` or `pgboss://…`. */
function schemeOf(value: string): string {
	const separator = value.indexOf(':');
	return separator === -1 ? value : value.slice(0, separator);
}

/**
 * A connection string for a broker whose driver nothing registered.
 *
 * The broker exists — this is not a typo'd scheme — but the process was never
 * told about it. Usually a script building its own publisher, or a build that
 * registered the drivers for a different target than the one that composed
 * the connection string.
 */
export class UnregisteredEventsScheme extends Error {
	/** The subpath that exports the missing driver. */
	readonly subpath: string;
	/** The driver's export name. */
	readonly driver: string;

	constructor(
		/** The scheme with no driver, without the colon — `'pgboss'`. */
		readonly scheme: string,
		/** What is registered, so the caller can see what was chosen instead. */
		readonly registered: readonly string[],
	) {
		const { subpath, driver } = BUILT_IN[scheme] ?? {
			subpath: `@geekmidas/events/${scheme}`,
			driver: `${scheme}EventsDriver`,
		};
		super(
			`No events driver is registered for '${scheme}://'. ` +
				(registered.length
					? `Registered: ${registered.join(', ')}. `
					: 'Nothing is registered. ') +
				`Register it once where the process starts: ` +
				`import { registerEventsDriver } from '@geekmidas/events'; ` +
				`import { ${driver} } from '${subpath}'; ` +
				`registerEventsDriver(${driver});`,
		);
		this.name = 'UnregisteredEventsScheme';
		this.subpath = subpath;
		this.driver = driver;
	}
}
