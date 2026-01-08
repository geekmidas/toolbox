import {
	DeleteMessageCommand,
	type Message,
	ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import type { EventSubscriber, PublishableMessage } from '../types';
import type { SQSConnection } from './SQSConnection';

export interface SQSSubscriberOptions {
	waitTimeSeconds?: number; // SQS long polling (default: 20)
	maxMessages?: number; // Max messages per poll (default: 10)
	expectedTopicArn?: string; // Optional: verify messages are from specific SNS topic
}

/**
 * SQS Subscriber - receives messages from an SQS queue
 *
 * This subscriber can receive:
 * 1. Direct SQS messages
 * 2. SNS messages that were pushed to the queue (SNS → SQS pattern)
 *
 * When receiving SNS messages, it:
 * - Automatically detects and parses the SNS wrapper format
 * - Filters by TopicArn (if expectedTopicArn is provided)
 * - Filters by message type
 * - Processes the actual message payload
 */
export class SQSSubscriber<TMessage extends PublishableMessage<string, any>>
	implements EventSubscriber<TMessage>
{
	private polling = false;
	private messageTypes: Set<TMessage['type']> = new Set();
	private listener?: (payload: TMessage) => Promise<void>;
	private options: Required<SQSSubscriberOptions>;

	constructor(
		private connection: SQSConnection,
		options: SQSSubscriberOptions = {},
	) {
		this.options = {
			waitTimeSeconds: options.waitTimeSeconds ?? 20,
			maxMessages: options.maxMessages ?? 10,
			expectedTopicArn: options.expectedTopicArn ?? '',
		};
	}

	async subscribe(
		messages: TMessage['type'][],
		listener: (payload: TMessage) => Promise<void>,
	): Promise<void> {
		this.messageTypes = new Set(messages);
		this.listener = listener;

		if (!this.connection.isConnected()) {
			await this.connection.connect();
		}

		this.polling = true;
		this.poll();
	}

	stop(): void {
		this.polling = false;
	}

	private async poll(): Promise<void> {
		while (this.polling) {
			try {
				const command = new ReceiveMessageCommand({
					QueueUrl: this.connection.queueUrl,
					MaxNumberOfMessages: this.options.maxMessages,
					WaitTimeSeconds: this.options.waitTimeSeconds,
					MessageAttributeNames: ['All'],
				});

				const response = await this.connection.sqsClient.send(command);

				if (response.Messages && response.Messages.length > 0) {
					await this.processMessages(response.Messages);
				}
			} catch (_error) {
				await this.sleep(1000);
			}
		}
	}

	private async processMessages(messages: Message[]): Promise<void> {
		for (const message of messages) {
			try {
				if (!message.Body) continue;

				// Try to parse as SNS message first
				const parsedMessage = this.parseMessage(message.Body);

				if (!parsedMessage) {
					// Not a valid message format
					await this.deleteMessage(message.ReceiptHandle!);
					continue;
				}

				const { payload, messageType, topicArn } = parsedMessage;

				// If expectedTopicArn is set, verify the message is from that topic
				if (this.options.expectedTopicArn && topicArn) {
					if (topicArn !== this.options.expectedTopicArn) {
						await this.deleteMessage(message.ReceiptHandle!);
						continue;
					}
				}

				// Check if we're subscribed to this message type
				if (
					messageType &&
					this.messageTypes.has(messageType as TMessage['type'])
				) {
					// Call listener
					if (this.listener) {
						await this.listener(payload as TMessage);
					}

					// Delete message after successful processing
					await this.deleteMessage(message.ReceiptHandle!);
				} else {
					// Delete messages we're not subscribed to
					await this.deleteMessage(message.ReceiptHandle!);
				}
			} catch (_error) {
				// Message will become visible again
			}
		}
	}

	/**
	 * Parse message body - handles both direct SQS messages and SNS-wrapped messages
	 */
	private parseMessage(body: string): {
		payload: unknown;
		messageType: string | undefined;
		topicArn?: string;
	} | null {
		try {
			const parsed = JSON.parse(body);

			// Check if this is an SNS notification wrapper
			if (parsed.Type === 'Notification' && parsed.Message) {
				// This is an SNS message
				const snsMessage = JSON.parse(parsed.Message);
				const messageType =
					parsed.MessageAttributes?.type?.Value || snsMessage.type;

				return {
					payload: snsMessage,
					messageType,
					topicArn: parsed.TopicArn,
				};
			}

			// This is a direct SQS message
			return {
				payload: parsed,
				messageType: parsed.type,
			};
		} catch (_error) {
			return null;
		}
	}

	private async deleteMessage(receiptHandle: string): Promise<void> {
		try {
			const command = new DeleteMessageCommand({
				QueueUrl: this.connection.queueUrl,
				ReceiptHandle: receiptHandle,
			});
			await this.connection.sqsClient.send(command);
		} catch (_error) {}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
