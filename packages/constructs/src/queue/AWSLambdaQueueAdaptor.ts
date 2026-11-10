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
import { isQueueResult, type Queue, type QueueRecord } from './Queue';

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
 * Uses SQS partial-batch responses: a record that fails to parse or validate
 * is returned in `batchItemFailures`, so SQS retries only it. After that, the
 * handler decides: returning a {@link QueueResult} retries only the records it
 * names, and throwing retries every record in the batch.
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
	 * `{ type, payload }`; a payload-only body is also accepted as-is. A queue
	 * built with `.envelope(false)` is never unwrapped: its body is the message.
	 */
	private extractPayload(record: SQSRecord): unknown {
		const body = this.safeJsonParse(record.body);
		if (!this.queue.envelope) {
			return body ?? record.body;
		}
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
		const records: QueueRecord<TMessage>[] = [];

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
				records.push({
					id: record.messageId,
					message: validation.value as InferStandardSchema<TMessage>,
				});
			} catch (error) {
				logger.error(
					{ error, messageId: record.messageId },
					'Failed to parse SQS record',
				);
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		if (records.length === 0) {
			return { batchItemFailures };
		}

		try {
			const result = await this.queue.handler({
				messages: records.map((r) => r.message),
				records,
				services,
				logger,
			});

			if (isQueueResult(result)) {
				const handed = new Set(records.map((r) => r.id));
				const unknown = result.failed.filter((id) => !handed.has(id));
				if (unknown.length > 0) {
					logger.warn(
						{ unknown },
						'Queue handler reported records not in its batch',
					);
				}
				for (const id of result.failed) {
					if (handed.has(id)) {
						batchItemFailures.push({ itemIdentifier: id });
					}
				}
			}
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
