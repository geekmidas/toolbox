import type { EventsDriver } from '../registry';
import { EventPublisherType } from '../types';
import { SNSConnection } from './SNSConnection';
import { SNSPublisher } from './SNSPublisher';
import { SNSSubscriber } from './SNSSubscriber';

/**
 * `sns://` — an SNS topic, consumed through an SQS queue subscribed to it.
 * Register it with `registerEventsDriver(snsEventsDriver)`; an AWS entry
 * registers `sqsEventsDriver` beside it.
 */
export const snsEventsDriver: EventsDriver = {
	scheme: EventPublisherType.SNS,
	connect: (url) => SNSConnection.fromConnectionString(url),
	publisher: (url) => SNSPublisher.fromConnectionString(url),
	publisherFor: (connection) => new SNSPublisher(connection as SNSConnection),
	subscriber: (url) => SNSSubscriber.fromConnectionString(url),
	subscriberFor: (connection) => new SNSSubscriber(connection as SNSConnection),
};
