// Generic types and interfaces

export { EventConnectionFactory } from './EventConnection';
export type { EventPublisherConnectionString } from './Publisher';

// Generic factories
export { Publisher } from './Publisher';
export type { EventSubscriberConnectionString } from './Subscriber';

export { Subscriber } from './Subscriber';
export type {
	EventConnection,
	EventPublisher,
	EventSubscriber,
	ExtractPublisherMessage,
	MappedEvent,
	PublishableMessage,
} from './types';
export { EventPublisherType } from './types';

// Specific integrations should be imported via subpaths:
// - @geekmidas/events/basic
// - @geekmidas/events/rabbitmq
// - @geekmidas/events/sqs
// - @geekmidas/events/sns
