import {
	type EventPublisher,
	type EventPublisherConnectionString,
	type PublishableMessage,
	Publisher,
} from '@geekmidas/events';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Construct, ConstructType } from '../Construct';

/** A topic's event contract — a map of event type → payload schema. */
export type TopicEvents = Record<string, StandardSchemaV1>;

/**
 * The union of wire messages a topic carries, derived from its event map:
 * `{ type: 'user.created'; payload: … } | { type: 'user.updated'; payload: … }`.
 */
export type TopicMessage<TEvents extends TopicEvents> = {
	[K in keyof TEvents & string]: PublishableMessage<
		K,
		InferStandardSchema<TEvents[K]>
	>;
}[keyof TEvents & string];

/**
 * A topic — pub/sub fan-out. Unlike a `Queue` (point-to-point, one consumer), a
 * topic is a *resource* owned by no single handler: it declares the event
 * contract, and any number of subscribers (`worker.topic(topic)`) bind to it.
 * `gkm build` discovers it into the manifest's `topics` field; infra provisions
 * an SNS topic.
 *
 * A construct publishes with `.event(topic, { type, payload })`, repeatable
 * across topics, each event going through its own topic's publisher. That also
 * puts `services.<topic>` in the handler, as `.dependsOn([topic])` does, for an
 * event the handler decides on itself.
 *
 * ```ts
 * export const users = new Topic('Users', {
 *   events: { 'user.created': z.object({ userId: z.string() }) },
 * });
 * ```
 */
export class Topic<
	TName extends string = string,
	TEvents extends TopicEvents = TopicEvents,
> extends Construct {
	__IS_TOPIC__ = true;

	static isTopic(obj: unknown): obj is Topic<string, TopicEvents> {
		return Boolean(
			obj &&
				(obj as { __IS_TOPIC__?: boolean }).__IS_TOPIC__ === true &&
				(obj as Construct).type === ConstructType.Topic,
		);
	}

	/**
	 * The canonical id this topic is declared under.
	 *
	 * Derived from the name, so `users` and `Users` are one topic. The name is
	 * left alone: subscribers bind to it and it is what the broker routes on.
	 */
	readonly id: string;

	/** The name it was declared with — what the broker routes on. */
	readonly name: TName;

	/**
	 * The event contract — a map of event type → payload schema. Named
	 * `eventSchemas` (not `events`) to avoid clashing with `Construct.events`,
	 * which is the array of `MappedEvent`s a construct *publishes*.
	 */
	readonly eventSchemas: TEvents;

	/**
	 * The topic as a dependency — what `.dependsOn([users])` and
	 * `.event(users, …)` dissolve into, reachable as `services.users`.
	 *
	 * The producer, because publishing is the only thing depending on a topic
	 * can mean: a subscriber binds to the topic instead, and is never handed
	 * this. It reads `<NAME>_PUBLISHER_CONNECTION_STRING` and picks the
	 * transport from its protocol — `pgboss://` locally, `sns://` deployed.
	 *
	 * A field assigned once, not a getter: services are cached by object
	 * identity, and a fresh literal on every access never hit that cache.
	 */
	readonly service: Service<
		Uncapitalize<TName>,
		EventPublisher<TopicMessage<TEvents>>
	>;

	/** The producer's env key, read by both {@link declare} and the service. */
	private readonly connectionKey: string;

	constructor(name: ConstructName<TName>, options: TopicOptions<TEvents>) {
		super(ConstructType.Topic, DEFAULT_LOGGER, [], []);

		this.name = name as TName;
		this.id = canonicalId(name as string);
		this.eventSchemas = options.events;
		this.connectionKey = provideKey(this.id, 'publisherConnectionString');

		const envVar = this.connectionKey;
		const topic = this.name as string;
		this.service = {
			serviceName: serviceKey(this.id) as Uncapitalize<TName>,
			async register({ envParser }) {
				const { connectionString } = envParser
					.create((get) => ({ connectionString: get(envVar).string() }))
					.parse();

				// Named as a topic, so a broker with one address for everything
				// (pg-boss) fans each message out to every subscriber.
				return Publisher.fromConnectionString<TopicMessage<TEvents>>(
					connectionString as EventPublisherConnectionString,
					{ topic },
				);
			},
		};
	}

	/**
	 * What this topic is in the manifest.
	 *
	 * Only the producer's key: a subscriber is *bound* to a topic rather than
	 * depending on it, so the binding is an edge the deploy target reads and not
	 * an env key anyone can hold. Locally both sides meet on the same broker.
	 */
	declare(): Declaration[] {
		return [
			{
				kind: 'topic',
				id: this.id,
				provides: [this.connectionKey],
				// The contract this topic carries. Structural: which events exist
				// is a fact about the application, and a subscriber binding to one
				// that does not is a mistake worth catching at build.
				events: this.eventTypes,
				// Bound rather than declared here — a subscriber names the topic,
				// not the other way round — so the build fills these from what it
				// found. Nested when it does, because position is the trigger.
				subscribers: [],
			},
		];
	}

	/** The event type names this topic carries. */
	get eventTypes(): (keyof TEvents & string)[] {
		return Object.keys(this.eventSchemas) as (keyof TEvents & string)[];
	}
}

export interface TopicOptions<TEvents extends TopicEvents> {
	/** Each event this topic carries — its type, and its payload's schema. */
	events: TEvents;
}
