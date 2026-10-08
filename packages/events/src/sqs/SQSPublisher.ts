import {
	SendMessageBatchCommand,
	type SendMessageBatchCommandInput,
	type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import chunk from 'lodash.chunk';
import { carrierAsAttributes, publishTraced } from '../telemetry';
import type { EventPublisher, PublishableMessage } from '../types';
import type { SQSConnection } from './SQSConnection';

export interface SQSPublisherOptions {
	maxBatchSize?: number; // Default: 10 (SQS limit)
}

export class SQSPublisher<TMessage extends PublishableMessage<string, any>>
	implements EventPublisher<TMessage>
{
	readonly options: Required<SQSPublisherOptions>;

	constructor(
		readonly connection: SQSConnection,
		options: SQSPublisherOptions = {},
	) {
		this.options = {
			maxBatchSize: options.maxBatchSize ?? 10, // SQS limit
		};
	}

	/**
	 * Create an SQSPublisher from a connection string
	 * Format: sqs://?queueUrl=https://sqs.region.amazonaws.com/accountId/queueName&region=us-east-1&endpoint=http://localhost:4566&maxBatchSize=10
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(connectionString: string): Promise<SQSPublisher<TMessage>> {
		const url = new URL(connectionString);
		const params = url.searchParams;

		const { SQSConnection } = await import('./SQSConnection');
		const connection =
			await SQSConnection.fromConnectionString(connectionString);

		const options: SQSPublisherOptions = {
			maxBatchSize: params.get('maxBatchSize')
				? Number.parseInt(params.get('maxBatchSize')!, 10)
				: undefined,
		};

		return new SQSPublisher<TMessage>(connection, options);
	}

	async publish(messages: TMessage[]): Promise<void> {
		if (messages.length === 0) return;

		if (!this.connection.isConnected()) {
			await this.connection.connect();
		}

		// Split messages into batches (SQS limit is 10 messages per batch)
		const batches = chunk(messages, this.options.maxBatchSize);

		// Send all batches
		await Promise.all(batches.map((batch) => this.sendBatch(batch)));
	}

	private async sendBatch(messages: TMessage[]): Promise<void> {
		const destination = sqsQueueName(this.connection.queueUrl);
		await publishTraced(
			messages,
			(message) => ({ system: 'aws_sqs', destination, type: message.type }),
			(carriers) =>
				this.send(
					messages.map((message, index) => ({
						Id: `${index}`,
						MessageBody: JSON.stringify({
							type: message.type,
							payload: message.payload,
						}),
						// The trace context as message attributes — SQS's own header
						// field — beside the type.
						MessageAttributes: {
							type: {
								DataType: 'String',
								StringValue: message.type,
							},
							...carrierAsAttributes(carriers[index]),
						},
					})),
				),
		);
	}

	private async send(entries: SendMessageBatchRequestEntry[]): Promise<void> {
		const input: SendMessageBatchCommandInput = {
			QueueUrl: this.connection.queueUrl,
			Entries: entries,
		};

		const command = new SendMessageBatchCommand(input);
		const response = await this.connection.sqsClient.send(command);

		// Check for failures
		if (response.Failed && response.Failed.length > 0) {
			throw new SqsBatchPartlyFailed(
				response.Failed.map((f) => ({
					id: f.Id,
					code: f.Code,
					message: f.Message,
				})),
			);
		}
	}

	async close(): Promise<void> {
		// Publisher doesn't own the connection
		// Connection should be closed by whoever created it
	}
}

/** SQS accepted the batch but refused some of its messages; the rest were sent. */
export class SqsBatchPartlyFailed extends Error {
	constructor(
		readonly failed: readonly {
			id?: string;
			code?: string;
			message?: string;
		}[],
	) {
		super(
			`Failed to send ${failed.length} messages: ${failed.map((f) => `${f.id}: ${f.code} - ${f.message}`).join(', ')}. The others in the batch were sent; retry only these.`,
		);
		this.name = 'SqsBatchPartlyFailed';
	}
}

/** The queue's name, the last segment of its URL. */
export function sqsQueueName(queueUrl: string): string {
	return queueUrl.split('/').filter(Boolean).pop() ?? queueUrl;
}
