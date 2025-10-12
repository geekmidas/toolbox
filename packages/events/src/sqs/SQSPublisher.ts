import {
  SendMessageBatchCommand,
  type SendMessageBatchCommandInput,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import type { EventPublisher, PublishableMessage } from '../types';
import type { SQSConnection } from './SQSConnection';

export interface SQSPublisherOptions {
  maxBatchSize?: number; // Default: 10 (SQS limit)
}

export class SQSPublisher<TMessage extends PublishableMessage<string, any>>
  implements EventPublisher<TMessage>
{
  private options: Required<SQSPublisherOptions>;

  constructor(
    private connection: SQSConnection,
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
    const connection = await SQSConnection.fromConnectionString(
      connectionString,
    );

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
    const batches = this.createBatches(messages);

    // Send all batches
    await Promise.all(batches.map((batch) => this.sendBatch(batch)));
  }

  private createBatches(messages: TMessage[]): TMessage[][] {
    const batches: TMessage[][] = [];
    for (let i = 0; i < messages.length; i += this.options.maxBatchSize) {
      batches.push(messages.slice(i, i + this.options.maxBatchSize));
    }
    return batches;
  }

  private async sendBatch(messages: TMessage[]): Promise<void> {
    const entries: SendMessageBatchRequestEntry[] = messages.map(
      (message, index) => ({
        Id: `${index}`,
        MessageBody: JSON.stringify({
          type: message.type,
          payload: message.payload,
        }),
        MessageAttributes: {
          type: {
            DataType: 'String',
            StringValue: message.type,
          },
        },
      }),
    );

    const input: SendMessageBatchCommandInput = {
      QueueUrl: this.connection.queueUrl,
      Entries: entries,
    };

    const command = new SendMessageBatchCommand(input);
    const response = await this.connection.sqsClient.send(command);

    // Check for failures
    if (response.Failed && response.Failed.length > 0) {
      const errors = response.Failed.map(
        (f) => `${f.Id}: ${f.Code} - ${f.Message}`,
      ).join(', ');
      throw new Error(
        `Failed to send ${response.Failed.length} messages: ${errors}`,
      );
    }
  }

  async close(): Promise<void> {
    // Publisher doesn't own the connection
    // Connection should be closed by whoever created it
  }
}
