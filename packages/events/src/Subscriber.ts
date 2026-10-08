import { eventsDriverFor, type SubscriberOptions } from './registry';
import type {
	EventConnection,
	EventPublisherType,
	EventSubscriber,
	PublishableMessage,
} from './types';

/**
 * Subscribers for a connection string or a connection, through whichever
 * driver is registered for its scheme — see `registerEventsDriver`.
 */
export class Subscriber {
	/**
	 * Create a subscriber from a connection string
	 * This creates both a connection and a subscriber
	 *
	 * @throws {UnregisteredEventsScheme} when the broker's driver is not
	 * registered.
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(
		connectionStr: EventSubscriberConnectionString,
	): Promise<EventSubscriber<TMessage>> {
		const scheme = new URL(connectionStr).protocol;
		return eventsDriverFor(scheme, 'subscriber').subscriber<TMessage>(
			connectionStr,
		);
	}

	/**
	 * Create a subscriber from an existing connection
	 * This allows sharing connections between publishers and subscribers
	 */
	static async fromConnection<TMessage extends PublishableMessage<string, any>>(
		connection: EventConnection,
		/**
		 * Subscribing to a topic as a named subscriber. pg-boss needs both to
		 * give each subscriber its own queue; the other transports carry the
		 * topic in their address and ignore it.
		 */
		options: SubscriberOptions = {},
	): Promise<EventSubscriber<TMessage>> {
		return eventsDriverFor(
			connection.type,
			'subscriber',
		).subscriberFor<TMessage>(connection, options);
	}
}

export type EventSubscriberConnectionString =
	`${EventPublisherType}://${string}`;
