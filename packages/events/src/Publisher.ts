import { eventsDriverFor } from './registry';
import type {
	EventConnection,
	EventPublisher,
	EventPublisherType,
	PublishableMessage,
} from './types';

/** How a publisher is used, beyond the address it reaches. */
export interface PublisherOptions {
	/**
	 * The topic this publisher fans out to. SNS and RabbitMQ name the topic in
	 * their address already; pg-boss has one address for every topic and queue,
	 * so it is told here that a message goes to every subscriber rather than to
	 * one queue.
	 */
	topic?: string;
}

/**
 * Publishers for a connection string or a connection, through whichever
 * driver is registered for its scheme — see `registerEventsDriver`.
 */
export class Publisher {
	/**
	 * Create a publisher from a connection string
	 * This creates both a connection and a publisher
	 *
	 * @throws {UnregisteredEventsScheme} when the broker's driver is not
	 * registered.
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(
		connectionStr: EventPublisherConnectionString,
		options: PublisherOptions = {},
	): Promise<EventPublisher<TMessage>> {
		const scheme = new URL(connectionStr).protocol;
		return eventsDriverFor(scheme, 'publisher').publisher<TMessage>(
			connectionStr,
			options,
		);
	}

	/**
	 * Create a publisher from an existing connection
	 * This allows sharing connections between publishers and subscribers
	 */
	static async fromConnection<TMessage extends PublishableMessage<string, any>>(
		connection: EventConnection,
		options: PublisherOptions = {},
	): Promise<EventPublisher<TMessage>> {
		return eventsDriverFor(connection.type, 'publisher').publisherFor<TMessage>(
			connection,
			options,
		);
	}
}

export type EventPublisherConnectionString =
	`${EventPublisherType}://${string}`;
