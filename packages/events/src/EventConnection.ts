import { eventsDriverFor } from './registry';
import type { EventConnection } from './types';

export class EventConnectionFactory {
	/**
	 * Create an EventConnection from a connection string, through whichever
	 * driver is registered for its scheme — see `registerEventsDriver`.
	 *
	 * @throws {UnregisteredEventsScheme} when the broker's driver is not
	 * registered.
	 */
	static async fromConnectionString(
		connectionStr: string,
	): Promise<EventConnection> {
		const scheme = new URL(connectionStr).protocol;
		return eventsDriverFor(scheme, 'connection').connect(connectionStr);
	}
}

export type { EventConnection } from './types';
export { EventPublisherType } from './types';
