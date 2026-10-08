import type { EventsDriver } from '../registry';
import { EventPublisherType } from '../types';
import { BasicConnection } from './BasicConnection';
import { BasicPublisher } from './BasicPublisher';
import { BasicSubscriber } from './BasicSubscriber';

/**
 * `basic://` — an in-process `EventEmitter`. Register it with
 * `registerEventsDriver(basicEventsDriver)`.
 */
export const basicEventsDriver: EventsDriver = {
	scheme: EventPublisherType.Basic,
	connect: (url) => BasicConnection.fromConnectionString(url),
	async publisher(url) {
		return new BasicPublisher(await BasicConnection.fromConnectionString(url));
	},
	publisherFor: (connection) =>
		new BasicPublisher(connection as BasicConnection),
	async subscriber(url) {
		return new BasicSubscriber(await BasicConnection.fromConnectionString(url));
	},
	subscriberFor: (connection) =>
		new BasicSubscriber(connection as BasicConnection),
};
