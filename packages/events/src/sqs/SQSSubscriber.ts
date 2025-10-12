import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import type { EventSubscriber, PublishableMessage } from '../types';
import type { SQSConnection } from './SQSConnection';

export interface SQSSubscriberOptions {
  maxMessages?: number; // Max messages to receive per poll (default: 10, max: 10)
  waitTimeSeconds?: number; // Long polling wait time (default: 20, max: 20)
  visibilityTimeout?: number; // Message visibility timeout in seconds (default: 30)
  pollingInterval?: number; // Interval between polls in ms when no messages (default: 1000)
}

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
      maxMessages: options.maxMessages ?? 10,
      waitTimeSeconds: options.waitTimeSeconds ?? 20,
      visibilityTimeout: options.visibilityTimeout ?? 30,
      pollingInterval: options.pollingInterval ?? 1000,
    };
  }

  /**
   * Create an SQSSubscriber from a connection string
   * Format: sqs://?queueUrl=...&maxMessages=10&waitTimeSeconds=20&visibilityTimeout=30
   */
  static async fromConnectionString<
    TMessage extends PublishableMessage<string, any>,
  >(connectionString: string): Promise<SQSSubscriber<TMessage>> {
    const url = new URL(connectionString);
    const params = url.searchParams;

    const { SQSConnection } = await import('./SQSConnection');
    const connection = await SQSConnection.fromConnectionString(
      connectionString,
    );

    const options: SQSSubscriberOptions = {
      maxMessages: params.get('maxMessages')
        ? Number.parseInt(params.get('maxMessages')!, 10)
        : undefined,
      waitTimeSeconds: params.get('waitTimeSeconds')
        ? Number.parseInt(params.get('waitTimeSeconds')!, 10)
        : undefined,
      visibilityTimeout: params.get('visibilityTimeout')
        ? Number.parseInt(params.get('visibilityTimeout')!, 10)
        : undefined,
      pollingInterval: params.get('pollingInterval')
        ? Number.parseInt(params.get('pollingInterval')!, 10)
        : undefined,
    };

    return new SQSSubscriber<TMessage>(connection, options);
  }

  async subscribe(
    messages: TMessage['type'][],
    listener: (payload: TMessage) => Promise<void>,
  ): Promise<void> {
    if (!this.connection.isConnected()) {
      await this.connection.connect();
    }

    // Store message types and listener
    this.messageTypes = new Set(messages);
    this.listener = listener;

    // Start polling
    this.polling = true;
    this.poll();
  }

  /**
   * Stop polling for messages
   */
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
          VisibilityTimeout: this.options.visibilityTimeout,
          MessageAttributeNames: ['All'],
        });

        const response = await this.connection.sqsClient.send(command);

        if (response.Messages && response.Messages.length > 0) {
          await this.processMessages(response.Messages);
        } else {
          // No messages, wait before polling again
          await this.sleep(this.options.pollingInterval);
        }
      } catch (error) {
        console.error('Error polling SQS:', error);
        // Wait before retrying
        await this.sleep(this.options.pollingInterval);
      }
    }
  }

  private async processMessages(messages: Message[]): Promise<void> {
    for (const message of messages) {
      try {
        if (!message.Body) continue;

        // Parse message
        const parsed = JSON.parse(message.Body);
        const messageType = message.MessageAttributes?.type?.StringValue;

        // Check if we're subscribed to this message type
        if (messageType && this.messageTypes.has(messageType as TMessage['type'])) {
          // Call listener
          if (this.listener) {
            await this.listener(parsed as TMessage);
          }

          // Delete message after successful processing
          await this.deleteMessage(message.ReceiptHandle!);
        }
      } catch (error) {
        console.error('Error processing message:', error);
        // Message will become visible again after visibility timeout
      }
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.connection.queueUrl,
        ReceiptHandle: receiptHandle,
      });
      await this.connection.sqsClient.send(command);
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
