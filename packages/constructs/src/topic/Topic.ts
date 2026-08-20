import {
	type EventPublisher,
	type EventPublisherConnectionString,
	type PublishableMessage,
	Publisher,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import {
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Construct, ConstructType } from '../Construct';

const DEFAULT_LOGGER = new ConsoleLogger() as unknown as Logger;

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
 * contract, derives a typed producer (`topic.publisher`), and any number of
 * subscribers (`s.topic(topic)`) bind to it. `gkm build` discovers it into the
 * manifest's `topics` field; infra provisions an SNS topic.
 *
 * This replaces hand-writing a publisher `Service`: the publisher is *derived*
 * from the declared event contract, the same way `Queue` derives its publisher.
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

	/**
	 * The producer's env key, read by both {@link declare} and
	 * {@link publisher} so the two cannot drift.
	 */
	private readonly connectionKey: string;

	constructor(
		public readonly name: TName,
		/**
		 * The event contract — a map of event type → payload schema. Named
		 * `eventSchemas` (not `events`) to avoid clashing with `Construct.events`,
		 * which is the array of `MappedEvent`s a construct *publishes*.
		 */
		public readonly eventSchemas: TEvents,
		logger: Logger = DEFAULT_LOGGER,
	) {
		super(ConstructType.Topic, logger, [], []);

		this.id = canonicalId(name);
		this.connectionKey = provideKey(this.id, 'publisherConnectionString');
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
			},
		];
	}

	/** The event type names this topic carries. */
	get eventTypes(): (keyof TEvents & string)[] {
		return Object.keys(this.eventSchemas) as (keyof TEvents & string)[];
	}

	/**
	 * The producer side — a `Service` exposing an `EventPublisher` typed to the
	 * union of this topic's events. Inject via `.publisher(topic.publisher)` (for
	 * declarative `.event(...)`) or `.services([topic.publisher])` (to publish
	 * imperatively). Reads `<NAME>_PUBLISHER_CONNECTION_STRING` and selects the
	 * transport from the URL protocol — `pgboss://` locally, `sns://` deployed.
	 *
	 * Because it's a `Service`, the connection-string requirement is sniffed into
	 * the manifest of whatever construct injects it (least-privilege linking).
	 */
	/**
	 * The topic as a dependency — what `.dependsOn([users])` dissolves into,
	 * reachable as `services.users`.
	 *
	 * It is the producer, because publishing is the only thing depending on a
	 * topic can mean: a subscriber *binds* with `s.topic(…)` instead, and is
	 * deliberately never handed this. {@link publisher} is the same service
	 * under its older `<name>Publisher` key.
	 */
	get service(): Service<
		Uncapitalize<TName>,
		EventPublisher<TopicMessage<TEvents>>
	> {
		const { register } = this.publisher;

		return {
			serviceName: serviceKey(this.id) as Uncapitalize<TName>,
			register,
		};
	}

	get publisher(): Service<
		`${TName}Publisher`,
		EventPublisher<TopicMessage<TEvents>>
	> {
		const envVar = this.connectionKey;
		return {
			serviceName: `${this.name}Publisher`,
			async register({ envParser }) {
				const { connectionString } = envParser
					.create((get) => ({
						connectionString: get(envVar).string(),
					}))
					.parse();

				return Publisher.fromConnectionString<TopicMessage<TEvents>>(
					connectionString as EventPublisherConnectionString,
				);
			},
		};
	}
}
