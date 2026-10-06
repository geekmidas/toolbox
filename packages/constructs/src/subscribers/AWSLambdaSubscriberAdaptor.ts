import type { EnvironmentParser } from '@geekmidas/envkit';
import { wrapError } from '@geekmidas/errors';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import { runWithRequestContext } from '@geekmidas/services';
import middy, { type MiddlewareObj } from '@middy/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Handler, SNSEvent, SQSEvent } from 'aws-lambda';
import {
	runSubscriber,
	subscribedEvents,
	subscriberContext,
} from './runSubscriber';
import type { Subscriber } from './Subscriber';

export type AWSLambdaHandler<TEvent = any, TResult = any> = Handler<
	TEvent,
	TResult
>;

type SubscriberEvent<TServices extends Service[], TLogger extends Logger> = {
	events: any[];
	services: ServiceRecord<TServices>;
	logger: TLogger;
	/** The subscriber's database, when it has one. */
	db?: unknown;
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
	TSubscribedEvents extends any[] = [],
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> {
	private _logger!: TLogger;

	constructor(
		private envParser: EnvironmentParser<{}>,
		readonly subscriber: Subscriber<
			TServices,
			TLogger,
			OutSchema,
			TEventPublisher,
			TSubscribedEvents,
			TDatabase,
			TDatabaseServiceName
		>,
	) {
		this._logger = subscriber.logger;
	}

	get logger(): TLogger {
		return this._logger;
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
				const { services, db } = await subscriberContext(
					this.subscriber,
					this.envParser,
				);
				req.event.services = services as ServiceRecord<TServices>;
				req.event.db = db;
			},
		};
	}

	private parseEvents(): Middleware<TServices, TLogger, OutSchema> {
		return {
			before: async (req) => {
				const { logger, ...rawEvent } = req.event;

				logger.info({
					rawEvent,
				});

				req.event.events = subscribedEvents(
					this.subscriber,
					rawEvent as unknown as SQSEvent | SNSEvent,
					this.logger,
				);
			},
		};
	}

	private async _handler(event: SubscriberEvent<TServices, TLogger>) {
		// Only these four: the raw Lambda event stays out of the handler.
		const { events, services, logger, db } = event;
		return runSubscriber(this.subscriber, {
			events,
			services,
			logger,
			db,
		}) as Promise<InferStandardSchema<OutSchema>>;
	}

	get handler(): AWSLambdaHandler {
		const handler = this._handler.bind(this);

		// Apply middleware in order
		const chain = middy(handler)
			.use(this.loggerMiddleware())
			.use(this.parseEvents())
			.use(this.error())
			.use(this.services());

		// Wrap entire Middy chain in request context for service access
		const wrappedHandler = async (event: unknown, context: Context) => {
			const startTime = Date.now();
			const requestId = context.awsRequestId;
			const logger = this.subscriber.logger.child({
				requestId,
			}) as TLogger;

			const operation = `subscriber ${this.subscriber.topicName ?? context.functionName}`;
			return runWithRequestContext(
				{ logger, requestId, startTime, operation },
				() => chain(event as Parameters<typeof chain>[0], context),
			);
		};

		return wrappedHandler as unknown as AWSLambdaHandler;
	}
}
