import type { InferStandardSchema } from '@geekmidas/schema';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Represents a publishable event message with a type and payload.
 *
 * @template TType - The event type/name (e.g., 'user.created')
 * @template TPayload - The event payload data
 */
export type PublishableMessage<TType extends string, TPayload> = {
	type: TType;
	payload: TPayload;
};

/**
 * Event publisher/subscriber types
 */
export enum EventPublisherType {
	Basic = 'basic',
	EventBridge = 'eventbridge',
	SQS = 'sqs',
	SNS = 'sns',
	Kafka = 'kafka',
	RabbitMQ = 'rabbitmq',
}

/**
 * Base interface for event connections
 * Connections manage the underlying transport (RabbitMQ channel, SQS client, etc.)
 */
export interface EventConnection {
	readonly type: EventPublisherType;
	connect(): Promise<void>;
	close(): Promise<void>;
	isConnected(): boolean;
}

/**
 * Interface for event publishers that handle the actual publishing of events.
 * Implementations can send to EventBridge, SQS, Kafka, or any other event system.
 *
 * @template TMessage - The union type of all publishable messages
 */
export type EventPublisher<TMessage extends PublishableMessage<string, any>> = {
	publish: (message: TMessage[]) => Promise<void>;
};

/**
 * Interface for event subscribers that handle receiving and processing events.
 *
 * @template TMessage - The union type of all publishable messages
 */
export type EventSubscriber<TMessage extends PublishableMessage<string, any>> =
	{
		subscribe: (
			messages: TMessage['type'][],
			listener: (payload: TMessage) => Promise<void>,
		) => Promise<void>;
	};
/**
 * Utility type to extract the message from EventPublisher
 */
export type ExtractPublisherMessage<T> =
	T extends EventPublisher<infer M> ? M : never;

export type MappedEvent<
	T extends EventPublisher<any> | undefined,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
> = {
	type: ExtractPublisherMessage<T>['type'];
	payload: (
		ctx: InferStandardSchema<OutSchema>,
	) => ExtractPublisherMessage<T>['payload'];
	when?: (ctx: InferStandardSchema<OutSchema>) => boolean;
};
