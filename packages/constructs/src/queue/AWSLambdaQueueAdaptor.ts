import type { EnvironmentParser } from '@geekmidas/envkit';
import { wrapError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import { runWithRequestContext, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	Context,
	Handler,
	SQSBatchResponse,
	SQSEvent,
	SQSRecord,
} from 'aws-lambda';
import type { Queue } from './Queue';

export type AWSLambdaHandler<TEvent = any, TResult = any> = Handler<
	TEvent,
	TResult
>;

/**
 * Runs a {@link Queue} worker as an AWS Lambda backed by an SQS event-source
 * mapping. Unlike a subscriber, a queue drains *every* record (no type filter):
 * each record body (`{ type, payload }`, as written by the SQS publisher) is
 * unwrapped to its `payload`, validated against the queue's `messageSchema`, and
 * the whole batch is handed to the handler as `messages`.
 *
 * Uses SQS partial-batch responses: a record that fails to parse, validate, or
 * (when the handler throws) process is returned in `batchItemFailures` so SQS
 * retries only those records.
 */
export class AWSLambdaQueue<
	TName extends string = string,
	TMessage extends StandardSchemaV1 = StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> {
	private _services?: ServiceRecord<TServices>;

	constructor(
		private readonly envParser: EnvironmentParser<{}>,
		readonly queue: Queue<TName, TMessage, TServices, TLogger>,
	) {}

	get logger(): TLogger {
		return this.queue.logger;
	}

	private async getServices(): Promise<ServiceRecord<TServices>> {
		if (this._services) {
			return this._services;
		}

		const serviceDiscovery = ServiceDiscovery.getInstance(this.envParser);

		this._services =
			this.queue.services.length > 0
				? ((await serviceDiscovery.register(
						this.queue.services,
					)) as ServiceRecord<TServices>)
				: ({} as ServiceRecord<TServices>);

		return this._services;
	}

	private safeJsonParse(value: string): unknown {
		try {
			return JSON.parse(value);
		} catch {
			return null;
		}
	}

	/**
	 * Unwrap the queue payload from an SQS record. The SQS publisher writes
	 * `{ type, payload }`; a payload-only body is also accepted as-is.
	 */
	private extractPayload(record: SQSRecord): unknown {
		const body = this.safeJsonParse(record.body);
		if (body && typeof body === 'object' && 'payload' in body) {
			return (body as { payload: unknown }).payload;
		}
		return body ?? record.body;
	}

	private async _handler(
		event: SQSEvent,
		context: Context,
	): Promise<SQSBatchResponse> {
		const logger = this.queue.logger.child({
			queue: {
				name: this.queue.name,
				fn: context.functionName,
			},
			req: { id: context.awsRequestId },
		}) as TLogger;

		const services = await this.getServices();
		const schema = this.queue.messageSchema;

		const batchItemFailures: { itemIdentifier: string }[] = [];
		const messages: InferStandardSchema<TMessage>[] = [];

		for (const record of event.Records) {
			try {
				const payload = this.extractPayload(record);
				const validation = await schema['~standard'].validate(payload);
				if (validation.issues) {
					logger.error(
						{ issues: validation.issues, messageId: record.messageId },
						'Queue message failed validation',
					);
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				messages.push(validation.value as InferStandardSchema<TMessage>);
			} catch (error) {
				logger.error(
					{ error, messageId: record.messageId },
					'Failed to parse SQS record',
				);
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		if (messages.length === 0) {
			return { batchItemFailures };
		}

		try {
			await this.queue.handler({ messages, services, logger });
		} catch (error) {
			logger.error(wrapError(error), 'Queue handler failed; retrying batch');
			// Handler processes the batch atomically — fail the whole batch so SQS
			// retries every (valid) record.
			for (const record of event.Records) {
				if (
					!batchItemFailures.some((f) => f.itemIdentifier === record.messageId)
				) {
					batchItemFailures.push({ itemIdentifier: record.messageId });
				}
			}
		}

		return { batchItemFailures };
	}

	get handler(): AWSLambdaHandler<SQSEvent, SQSBatchResponse> {
		const handler = this._handler.bind(this);

		return (async (event: SQSEvent, context: Context) => {
			const startTime = Date.now();
			const requestId = context.awsRequestId;
			const logger = this.queue.logger.child({ requestId }) as TLogger;

			return runWithRequestContext({ logger, requestId, startTime }, () =>
				handler(event, context),
			);
		}) as unknown as AWSLambdaHandler<SQSEvent, SQSBatchResponse>;
	}
}
