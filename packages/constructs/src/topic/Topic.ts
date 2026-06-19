import { environmentCase } from '@geekmidas/envkit';
import {
	type EventPublisher,
	type EventPublisherConnectionString,
	type PublishableMessage,
	Publisher,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
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
	get publisher(): Service<
		`${TName}Publisher`,
		EventPublisher<TopicMessage<TEvents>>
	> {
		const envVar = `${environmentCase(this.name)}_PUBLISHER_CONNECTION_STRING`;
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
