import type { EventsDriver } from '../registry';
import { EventPublisherType } from '../types';
import { PgBossConnection } from './PgBossConnection';
import { PgBossPublisher } from './PgBossPublisher';
import { PgBossSubscriber } from './PgBossSubscriber';

/**
 * `pgboss://` — queues and topics in Postgres. Register it with
 * `registerEventsDriver(pgbossEventsDriver)`; this subpath is the only one
 * that imports `pg-boss`.
 */
export const pgbossEventsDriver: EventsDriver = {
	scheme: EventPublisherType.PgBoss,
	connect: (url) => PgBossConnection.fromConnectionString(url),
	publisher: (url, options) =>
		PgBossPublisher.fromConnectionString(url, options),
	publisherFor: (connection, options) =>
		new PgBossPublisher(connection as PgBossConnection, options),
	subscriber: (url) => PgBossSubscriber.fromConnectionString(url),
	subscriberFor: (connection, options) =>
		new PgBossSubscriber(connection as PgBossConnection, options),
};
