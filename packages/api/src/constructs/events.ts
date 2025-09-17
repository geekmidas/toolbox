import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Logger } from '../logger';
import type { Service } from '../services';
import type { EndpointContext, EndpointSchemas } from './Endpoint';
import type { InferStandardSchema } from './types';

/**
 * Event Publishing System
 *
 * The @geekmidas/api framework includes automatic event publishing capabilities that
 * allow endpoints to publish events after successful execution (2xx status codes).
 *
 * Key Features:
 * - Type-safe event definitions
 * - Automatic publishing after successful responses
 * - Conditional event publishing with `when` clauses
 * - Support for multiple events per endpoint
 * - Publisher error handling that doesn't affect endpoint responses
 *
 * @example
 * ```typescript
 * // Define event types
 * type UserEvent =
 *   | PublishableMessage<'user.created', { userId: string; email: string }>
 *   | PublishableMessage<'user.updated', { userId: string; changes: string[] }>;
 *
 * // Create publisher
 * class MyPublisher implements EventPublisher<UserEvent> {
 *   async publish(events: UserEvent[]): Promise<void> {
 *     // Send to event bus, queue, etc.
 *   }
 * }
 *
 * // Use in endpoint
 * const endpoint = e
 *   .publisher(new MyPublisher())
 *   .post('/users')
 *   .event({
 *     type: 'user.created',
 *     payload: (response) => ({ userId: response.id, email: response.email }),
 *   })
 *   .handle(async () => {
 *     // Create user logic
 *     return user; // Event published automatically
 *   });
 * ```
 */

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
 * Interface for event publishers that handle the actual publishing of events.
 * Implementations can send to EventBridge, SQS, Kafka, or any other event system.
 *
 * @template TMessage - The union type of all publishable messages
 */
export type EventPublisher<TMessage extends PublishableMessage<string, any>> = {
  publish: (message: TMessage[]) => Promise<void>;
};

// Utility type to extract the message from EventPublisher
export type ExtractPublisherMessage<T> = T extends EventPublisher<infer M>
  ? M
  : never;

export type EventContext<
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
> = {
  response: InferStandardSchema<OutSchema>;
} & EndpointContext<TInput, TServices, TLogger, TSession>;

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
