// Generic types and interfaces
export type {
  EventConnection,
  EventPublisher,
  EventSubscriber,
  ExtractPublisherMessage,
  MappedEvent,
  PublishableMessage,
} from './types';
export { EventPublisherType } from './types';

// Generic factories
export { Publisher } from './Publisher';
export type { EventPublisherConnectionString } from './Publisher';

export { Subscriber } from './Subscriber';
export type { EventSubscriberConnectionString } from './Subscriber';

export { EventConnectionFactory } from './EventConnection';

// Specific integrations should be imported via subpaths:
// - @geekmidas/events/basic
// - @geekmidas/events/rabbitmq
// - @geekmidas/events/sqs
// - @geekmidas/events/sns
