import {
	EventConnectionFactory,
	type EventPublisher,
	Publisher,
} from '@geekmidas/events';
import type { Service } from '@geekmidas/services';
import type { AppEvents } from '../events/types.js';

type AppPublisher = EventPublisher<AppEvents>;

/**
 * The topic publisher — fans domain events out to subscribers (`s`). Reads
 * `EVENT_PUBLISHER_CONNECTION_STRING` (pg-boss locally, SNS deployed). Inject via
 * `.publisher(EventsService)` on the endpoint factory so `.event(...)` declarations
 * are delivered.
 *
 * No sniffer guard or module singleton: the `.create((get) => …)` call records the
 * env var for the manifest, `ServiceDiscovery` caches the resolved publisher, and a
 * failed connect during env-sniffing is swallowed (the var is still captured).
 */
export const EventsService = {
	serviceName: 'events' as const,
	async register({ envParser }) {
		const { connectionString } = envParser
			.create((get) => ({
				connectionString: get('EVENT_PUBLISHER_CONNECTION_STRING').string(),
			}))
			.parse();

		const connection =
			await EventConnectionFactory.fromConnectionString(connectionString);
		return Publisher.fromConnection<AppEvents>(connection);
	},
} satisfies Service<'events', AppPublisher>;
