import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Construct } from './Construct';
import type { Topic } from './topic/Topic';

/**
 * An event a construct publishes to a topic once its handler has succeeded.
 *
 * It carries its topic, so a construct can publish to as many topics as it
 * names — each event goes through the publisher of the topic it was declared
 * against, never a single shared one.
 */
export interface TopicEvent<TOutput = any> {
	/** The topic's service: the publisher this event is sent through. */
	topic: Service<string, EventPublisher<any>>;
	type: string;
	/** The event's payload, from what the handler returned. */
	payload: (output: TOutput) => unknown;
	/** Publish only when this holds for what the handler returned. */
	when?: (output: TOutput) => boolean;
}

/**
 * What `.event(topic, …)` takes: one of the topic's event types, and a payload
 * of that event's shape built from the handler's output.
 */
export type EventFor<
	TTopic extends Topic<any, any>,
	TOutput,
> = TTopic extends Topic<string, infer TEvents>
	? {
			[K in keyof TEvents & string]: {
				type: K;
				payload: (output: TOutput) => InferStandardSchema<TEvents[K]>;
				when?: (output: TOutput) => boolean;
			};
		}[keyof TEvents & string]
	: never;

/** A topic event, bound to its topic — what the builders store. */
export function topicEvent<TTopic extends Topic<any, any>>(
	topic: TTopic,
	event: EventFor<TTopic, any>,
): TopicEvent {
	return {
		topic: topic.service as Service<string, EventPublisher<any>>,
		type: event.type,
		payload: event.payload,
		...(event.when ? { when: event.when } : {}),
	};
}

/**
 * Publish a construct's events for what its handler returned, each through
 * its own topic's publisher.
 *
 * Failures are logged, never thrown: the handler has already succeeded, and an
 * event that could not be delivered must not turn its response into an error.
 */
export async function publishEvents<
	OutSchema extends StandardSchemaV1 | undefined = undefined,
>(
	logger: Logger,
	serviceDiscovery: ServiceDiscovery<any>,
	events: readonly TopicEvent[] = [],
	response: InferStandardSchema<OutSchema>,
	/**
	 * Publishers already in hand, by service name — what a test passes as
	 * `services` — used before anything is registered.
	 */
	provided: Readonly<Record<string, unknown>> = {},
) {
	try {
		if (!events.length) {
			logger.debug('No events to publish');
			return;
		}

		// What to send, by topic — resolved before anything is published, so a
		// payload that throws publishes nothing rather than half.
		const byTopic = new Map<
			string,
			{
				topic: TopicEvent['topic'];
				messages: { type: string; payload: unknown }[];
			}
		>();
		for (const { topic, type, payload, when } of events) {
			if (when && !when(response)) continue;

			logger.debug({ event: type }, 'Processing event');
			const group = byTopic.get(topic.serviceName) ?? { topic, messages: [] };
			group.messages.push({ type, payload: await payload(response) });
			byTopic.set(topic.serviceName, group);
		}

		if (!byTopic.size) return;

		const missing = [...byTopic.values()]
			.map(({ topic }) => topic)
			.filter((topic) => !(topic.serviceName in provided));
		const services = {
			...(missing.length ? await serviceDiscovery.register(missing) : {}),
			...provided,
		} as Record<string, unknown>;

		await Promise.all(
			[...byTopic.values()].map(async ({ topic, messages }) => {
				logger.debug(
					{ topic: topic.serviceName, eventCount: messages.length },
					'Publishing events',
				);
				const publisher = services[topic.serviceName] as EventPublisher<any>;
				await publisher.publish(messages).catch((err) => {
					logger.error(err, 'Failed to publish events');
				});
			}),
		);
	} catch (error) {
		logger.error(error as any, 'Something went wrong publishing events');
	}
}

/** Publish a construct's declared events for what its handler returned. */
export async function publishConstructEvents<
	OutSchema extends StandardSchemaV1 | undefined = undefined,
>(
	construct: Pick<Construct, 'events' | 'logger'>,
	response: InferStandardSchema<OutSchema>,
	serviceDiscovery: ServiceDiscovery<any>,
	logger: Logger = construct.logger,
	provided: Readonly<Record<string, unknown>> = {},
) {
	return publishEvents(
		logger,
		serviceDiscovery,
		construct.events,
		response,
		provided,
	);
}
