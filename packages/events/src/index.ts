// Generic types and interfaces

export { EventConnectionFactory } from './EventConnection';
export type { EventPublisherConnectionString } from './Publisher';

// Generic factories
export { Publisher, type PublisherOptions } from './Publisher';
// Which brokers exist is the entry point's decision. Each is a driver on its
// own subpath — the only module that imports its client library — and is
// registered once where the process starts:
//
//   import { registerEventsDriver } from '@geekmidas/events';
//   import { pgbossEventsDriver } from '@geekmidas/events/pgboss';
//   registerEventsDriver(pgbossEventsDriver);
//
// - @geekmidas/events/basic     basicEventsDriver
// - @geekmidas/events/pgboss    pgbossEventsDriver
// - @geekmidas/events/rabbitmq  rabbitmqEventsDriver
// - @geekmidas/events/sns       snsEventsDriver
// - @geekmidas/events/sqs       sqsEventsDriver
export {
	type EventsDriver,
	eventsDriverFor,
	registerEventsDriver,
	registeredEventsSchemes,
	type SubscriberOptions,
	UnregisteredEventsScheme,
} from './registry';
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
export { EventPublisherType, UnsupportedEventTransport } from './types';
