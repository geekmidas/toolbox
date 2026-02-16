import type { EnvironmentParser } from '@geekmidas/envkit';
import { wrapError } from '@geekmidas/errors';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import middy, { type MiddlewareObj } from '@middy/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	Context,
	Handler,
	SNSEvent,
	SNSEventRecord,
	SQSEvent,
	SQSRecord,
} from 'aws-lambda';
import type { Subscriber } from './Subscriber';

export type AWSLambdaHandler<TEvent = any, TResult = any> = Handler<
	TEvent,
	TResult
>;

type SubscriberEvent<TServices extends Service[], TLogger extends Logger> = {
	events: any[];
	services: ServiceRecord<TServices>;
	logger: TLogger;
};

type Middleware<
	TServices extends Service[],
	TLogger extends Logger,
	TOutSchema extends StandardSchemaV1 | undefined,
> = MiddlewareObj<
	SubscriberEvent<TServices, TLogger>,
	InferStandardSchema<TOutSchema>,
	Error,
	Context
>;

export class AWSLambdaSubscriber<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TEventPublisherServiceName extends string = string,
	TSubscribedEvents extends any[] = [],
> {
	private _logger!: TLogger;
	private _services!: ServiceRecord<TServices>;

	constructor(
		private envParser: EnvironmentParser<{}>,
		readonly subscriber: Subscriber<
			TServices,
			TLogger,
			OutSchema,
			TEventPublisher,
			TEventPublisherServiceName,
			TSubscribedEvents
		>,
	) {
		this._logger = subscriber.logger;
	}

	get logger(): TLogger {
		return this._logger;
	}

	private async getServices(): Promise<ServiceRecord<TServices>> {
		if (this._services) {
			return this._services;
		}

		const serviceDiscovery = ServiceDiscovery.getInstance(this.envParser);

		if (this.subscriber.services.length > 0) {
			const registered = await serviceDiscovery.register(
				this.subscriber.services,
			);
			this._services = registered as ServiceRecord<TServices>;
		} else {
			this._services = {} as ServiceRecord<TServices>;
		}

		return this._services;
	}

	private error(): Middleware<TServices, TLogger, OutSchema> {
		return {
			onError: (req) => {
				const logger = req.event?.logger || this.subscriber.logger;
				logger.error(req.error || {}, 'Error processing subscriber');

				// Re-throw the wrapped error to let Lambda handle it
				throw wrapError(req.error);
			},
		};
	}

	private loggerMiddleware(): Middleware<TServices, TLogger, OutSchema> {
		return {
			before: (req) => {
				this._logger = this.subscriber.logger.child({
					subscriber: {
						name: req.context.functionName,
						version: req.context.functionVersion,
						memory: req.context.memoryLimitInMB,
					},
					req: {
						id: req.context.awsRequestId,
					},
				}) as TLogger;

				req.event.logger = this._logger;
			},
		};
	}

	private services(): Middleware<TServices, TLogger, OutSchema> {
		return {
			before: async (req) => {
				req.event.services = await this.getServices();
			},
		};
	}

	private parseEvents(): Middleware<TServices, TLogger, OutSchema> {
		return {
			before: async (req) => {
				const { logger, ...e } = req.event;
				const rawEvent = e as any as SQSEvent | SNSEvent;

				logger.info({
					rawEvent,
				});

				// Parse events based on the event type
				const events: any[] = [];

				if ('Records' in rawEvent) {
					if (this.isSQSEvent(rawEvent)) {
						// SQS Event
						for (const record of rawEvent.Records) {
							try {
								const event = this.parseSQSRecord(record);
								if (this.shouldIncludeEvent(event)) {
									events.push(event);
								}
							} catch (error) {
								this.logger.error(
									{ error, record },
									'Failed to parse SQS record',
								);
							}
						}
					} else if (this.isSNSEvent(rawEvent)) {
						// SNS Event
						for (const record of rawEvent.Records) {
							try {
								const event = this.parseSNSRecord(record);
								if (this.shouldIncludeEvent(event)) {
									events.push(event);
								}
							} catch (error) {
								this.logger.error(
									{ error, record },
									'Failed to parse SNS record',
								);
							}
						}
					}
				}

				(req.event as any).events = events;
			},
		};
	}

	private isSQSEvent(event: SQSEvent | SNSEvent): event is SQSEvent {
		const firstRecord = event.Records[0];
		return (
			'Records' in event &&
			event.Records.length > 0 &&
			firstRecord !== undefined &&
			'eventSource' in firstRecord &&
			firstRecord.eventSource === 'aws:sqs'
		);
	}

	private isSNSEvent(event: SQSEvent | SNSEvent): event is SNSEvent {
		const firstRecord = event.Records[0];
		return (
			'Records' in event &&
			event.Records.length > 0 &&
			firstRecord !== undefined &&
			'EventSource' in firstRecord &&
			firstRecord.EventSource === 'aws:sns'
		);
	}

	private parseSNSRecord(record: SNSEventRecord): any {
		const message = this.safeJsonParse(record.Sns.Message);
		const messageType = record.Sns.MessageAttributes?.type?.Value;

		// Not JSON — wrap raw string with type from MessageAttributes if available
		if (message === null) {
			return messageType
				? { type: messageType, payload: record.Sns.Message }
				: record.Sns.Message;
		}

		// Resolve type from MessageAttributes (preferred) or message body
		const resolvedType = messageType ?? message.type;

		if (message.type) {
			return message; // Full event format: { type, payload }
		}

		// Payload-only format: type is in MessageAttributes
		return resolvedType ? { type: resolvedType, payload: message } : message;
	}

	private parseSQSRecord(record: SQSRecord): any {
		const body = this.safeJsonParse(record.body);

		// Not JSON — return raw body as-is
		if (body === null) {
			return record.body;
		}

		// Check if this is an SNS message wrapped in SQS
		if (body.Type === 'Notification' && body.Message) {
			const snsMessage = this.safeJsonParse(body.Message);
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
			const resolvedType = messageType ?? snsMessage.type;
			return resolvedType
				? { type: resolvedType, payload: snsMessage }
				: snsMessage;
		}

		// Direct SQS message
		return body;
	}

	private safeJsonParse(value: string): any | null {
		try {
			return JSON.parse(value);
		} catch {
			return null;
		}
	}

	private shouldIncludeEvent(event: any): boolean {
		// No event type (raw string/non-object) — always include
		if (typeof event !== 'object' || !event?.type) {
			return true;
		}

		// No filter configured — accept all
		if (!this.subscriber.subscribedEvents) {
			return true;
		}

		return this.subscriber.subscribedEvents.includes(event.type as any);
	}

	private async _handler(event: SubscriberEvent<TServices, TLogger>) {
		// If no events after filtering, return early
		if (event.events.length === 0) {
			this.logger.info('No subscribed events to process');
			return {
				batchItemFailures: [],
			};
		}

		// Execute the subscriber with the parsed context
		const result = await this.subscriber.handler({
			events: event.events,
			services: event.services,
			logger: event.logger,
		});

		// Parse output if schema is provided
		if (this.subscriber.outputSchema && result) {
			const validationResult =
				await this.subscriber.outputSchema['~standard'].validate(result);

			if (validationResult.issues) {
				this.logger.error(
					{ issues: validationResult.issues },
					'Subscriber output validation failed',
				);
				throw new Error('Subscriber output validation failed');
			}

			return validationResult.value;
		}

		return result;
	}

	get handler(): AWSLambdaHandler {
		const handler = this._handler.bind(this);

		// Apply middleware in order
		return middy(handler)
			.use(this.loggerMiddleware())
			.use(this.parseEvents())
			.use(this.error())
			.use(this.services());
	}
}
