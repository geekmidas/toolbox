/**
 * What a subscriber does with a batch of records, however they arrived: parse
 * them into events, keep the ones it subscribed to, and run its handler with
 * its services and database.
 *
 * Shared by the Lambda adaptor, which wraps it in middy, and the SNS push
 * adaptor, which a server runs and which must not need middy to load.
 */

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import type { SNSEvent, SNSEventRecord, SQSEvent, SQSRecord } from 'aws-lambda';
import type { Subscriber } from './Subscriber';

type AnySubscriber = Subscriber<any, any, any, any, any, any, any>;

/** The subscriber's output did not match its `.output()` schema. */
export class SubscriberOutputInvalid extends Error {
	constructor(readonly issues: ReadonlyArray<unknown>) {
		super(
			"Subscriber output validation failed: the handler's result does not match its .output() schema.",
		);
		this.name = 'SubscriberOutputInvalid';
	}
}

/** The events in an SQS or SNS batch (a Lambda event's `Records`) that `subscriber` subscribed to. */
export function subscribedEvents(
	subscriber: AnySubscriber,
	rawEvent: { Records?: readonly unknown[] },
	logger: Logger,
): any[] {
	const events: any[] = [];
	const records = rawEvent.Records ?? [];
	const first = records[0] as any;
	const parse =
		first?.eventSource === 'aws:sqs'
			? (record: any) => parseSQSRecord(record)
			: first?.EventSource === 'aws:sns'
				? (record: any) => parseSNSRecord(record)
				: undefined;
	if (!parse) return events;

	for (const record of records) {
		try {
			const event = parse(record);
			if (isSubscribed(subscriber, event)) events.push(event);
		} catch (error) {
			logger.error({ err: error, record }, 'Failed to parse record');
		}
	}
	return events;
}

/** The subscriber's services and database, registered as functions do. */
export async function subscriberContext(
	subscriber: AnySubscriber,
	envParser: EnvironmentParser<{}>,
): Promise<{ services: Record<string, unknown>; db: unknown }> {
	const discovery = ServiceDiscovery.getInstance(envParser);
	const services =
		subscriber.services.length > 0
			? await discovery.register(subscriber.services)
			: {};
	const service = subscriber.databaseService;
	const db = service
		? (await discovery.register([service]))[service.serviceName]
		: undefined;
	return { services, db };
}

/** Runs the handler on `events`, and checks its output against its schema. */
export async function runSubscriber(
	subscriber: AnySubscriber,
	context: {
		events: any[];
		services: Record<string, unknown>;
		db: unknown;
		logger: Logger;
	},
): Promise<unknown> {
	if (context.events.length === 0) {
		context.logger.info('No subscribed events to process');
		return { batchItemFailures: [] };
	}

	const { events, services, db, logger } = context;
	const result = await subscriber.handler({
		events,
		services,
		logger,
		db,
	} as any);

	if (subscriber.outputSchema && result) {
		const validation =
			await subscriber.outputSchema['~standard'].validate(result);
		if (validation.issues) {
			context.logger.error(
				{ issues: validation.issues },
				'Subscriber output validation failed',
			);
			throw new SubscriberOutputInvalid(validation.issues);
		}
		return validation.value;
	}

	return result;
}

function isSubscribed(subscriber: AnySubscriber, event: any): boolean {
	// No event type (raw string/non-object) — always include
	if (typeof event !== 'object' || !event?.type) return true;
	// No filter configured — accept all
	if (!subscriber.subscribedEvents) return true;
	return subscriber.subscribedEvents.includes(event.type);
}

function parseSNSRecord(record: SNSEventRecord): any {
	const message = safeJsonParse(record.Sns.Message);
	const messageType = record.Sns.MessageAttributes?.type?.Value;

	// Not JSON — wrap raw string with type from MessageAttributes if available
	if (message === null) {
		return messageType
			? { type: messageType, payload: record.Sns.Message }
			: record.Sns.Message;
	}

	if (message.type) {
		return message; // Full event format: { type, payload }
	}

	// Payload-only format: type is in MessageAttributes
	return messageType ? { type: messageType, payload: message } : message;
}

function parseSQSRecord(record: SQSRecord): any {
	const body = safeJsonParse(record.body);

	// Not JSON — return raw body as-is
	if (body === null) {
		return record.body;
	}

	// Check if this is an SNS message wrapped in SQS
	if (body.Type === 'Notification' && body.Message) {
		const snsMessage = safeJsonParse(body.Message);
		const messageType = body.MessageAttributes?.type?.Value;

		// SNS Message not JSON — wrap with type from MessageAttributes if available
		if (snsMessage === null) {
			return messageType
				? { type: messageType, payload: body.Message }
				: body.Message;
		}

		if (snsMessage.type) {
			return snsMessage; // Full event format: { type, payload }
		}

		// Payload-only format: type is in MessageAttributes
		return messageType
			? { type: messageType, payload: snsMessage }
			: snsMessage;
	}

	// Direct SQS message
	return body;
}

function safeJsonParse(value: string): any | null {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
