import { type EventsDriver, eventsDriverFor } from '../registry';
import { EventPublisherType } from '../types';
import { SQSConnection } from './SQSConnection';
import { SQSPublisher } from './SQSPublisher';
import { SQSSubscriber } from './SQSSubscriber';

/**
 * `sqs://` — an SQS queue. Register it with
 * `registerEventsDriver(sqsEventsDriver)`; this subpath is the only one that
 * imports `@aws-sdk/client-sqs` on its own.
 */
export const sqsEventsDriver: EventsDriver = {
	scheme: EventPublisherType.SQS,
	connect: (url) => SQSConnection.fromConnectionString(url),
	publisher: (url) => SQSPublisher.fromConnectionString(url),
	publisherFor: (connection) => new SQSPublisher(connection as SQSConnection),
	async subscriber(url) {
		// A queue named with the topic it is subscribed to is a managed SNS→SQS
		// subscription, which is the SNS driver's to build — reached through the
		// registry, so this subpath never imports the SNS client.
		if (new URL(url).searchParams.get('topicArn')) {
			return eventsDriverFor(EventPublisherType.SNS, 'subscriber').subscriber(
				url.replace(/^sqs:/, 'sns:'),
			);
		}
		return new SQSSubscriber(await SQSConnection.fromConnectionString(url));
	},
	subscriberFor: (connection) => new SQSSubscriber(connection as SQSConnection),
};
