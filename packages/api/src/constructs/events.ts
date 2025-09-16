import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Logger } from '../logger';
import type { Service } from '../services';
import type { EndpointContext, EndpointSchemas } from './Endpoint';
import type { InferStandardSchema } from './types';

export type PublishableMessage<TType extends string, TPayload> = {
  type: TType;
  payload: TPayload;
};

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
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
> = {
  type: ExtractPublisherMessage<T>['type'];
  payload: (
    ctx: EventContext<TInput, TServices, TLogger, TSession, OutSchema>,
  ) => ExtractPublisherMessage<T>['payload'];
  when?: (
    ctx: EventContext<TInput, TServices, TLogger, TSession, OutSchema>,
  ) => boolean | Promise<boolean>;
};
