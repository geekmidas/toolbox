import type { EventsDriver } from '../registry';
import { EventPublisherType } from '../types';
import { RabbitMQConnection } from './RabbitMQConnection';
import { RabbitMQPublisher } from './RabbitMQPublisher';
import { RabbitMQSubscriber } from './RabbitMQSubscriber';

/**
 * `rabbitmq://` — an AMQP exchange. Register it with
 * `registerEventsDriver(rabbitmqEventsDriver)`; this subpath is the only one
 * that imports `amqplib`.
 */
export const rabbitmqEventsDriver: EventsDriver = {
	scheme: EventPublisherType.RabbitMQ,
	connect: (url) => RabbitMQConnection.fromConnectionString(url),
	publisher: (url) => RabbitMQPublisher.fromConnectionString(url),
	publisherFor: (connection) =>
		new RabbitMQPublisher(connection as RabbitMQConnection),
	subscriber: (url) => RabbitMQSubscriber.fromConnectionString(url),
	subscriberFor: (connection) =>
		new RabbitMQSubscriber(connection as RabbitMQConnection),
};
