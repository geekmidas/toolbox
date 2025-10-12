import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchCommandInput,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import type { EventPublisher, PublishableMessage } from '../types';

export interface SQSPublisherConfig {
  queueUrl: string;
  region?: string;
  endpoint?: string; // Custom endpoint (e.g., for LocalStack)
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  maxBatchSize?: number; // Default: 10 (SQS limit)
}

export class SQSPublisher<TMessage extends PublishableMessage<string, any>>
  implements EventPublisher<TMessage>
{
  private client: SQSClient;
  private config: Required<Pick<SQSPublisherConfig, 'maxBatchSize'>> &
    SQSPublisherConfig;

  constructor(config: SQSPublisherConfig) {
    this.config = {
      ...config,
      maxBatchSize: config.maxBatchSize ?? 10, // SQS limit
    };

    this.client = new SQSClient({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
    });
  }

  /**
   * Create an SQSPublisher from a connection string
   * Format: sqs://?queueUrl=https://sqs.region.amazonaws.com/accountId/queueName&region=us-east-1&endpoint=http://localhost:4566
   */
  static async fromConnectionString<
    TMessage extends PublishableMessage<string, any>,
  >(connectionString: string): Promise<SQSPublisher<TMessage>> {
    const url = new URL(connectionString);
    const params = url.searchParams;

    const queueUrl = params.get('queueUrl');
    if (!queueUrl) {
      throw new Error('queueUrl parameter is required in connection string');
    }

    const config: SQSPublisherConfig = {
      queueUrl,
      region: params.get('region') || undefined,
      endpoint: params.get('endpoint') || undefined,
      maxBatchSize: params.get('maxBatchSize')
        ? Number.parseInt(params.get('maxBatchSize')!, 10)
        : undefined,
    };

    // Parse credentials if provided
    const accessKeyId = params.get('accessKeyId');
    const secretAccessKey = params.get('secretAccessKey');
    if (accessKeyId && secretAccessKey) {
      config.credentials = {
        accessKeyId,
        secretAccessKey,
        sessionToken: params.get('sessionToken') || undefined,
      };
    }

    return new SQSPublisher<TMessage>(config);
  }

  async publish(messages: TMessage[]): Promise<void> {
    if (messages.length === 0) return;

    // Split messages into batches (SQS limit is 10 messages per batch)
    const batches = this.createBatches(messages);

    // Send all batches
    await Promise.all(batches.map((batch) => this.sendBatch(batch)));
  }

  private createBatches(messages: TMessage[]): TMessage[][] {
    const batches: TMessage[][] = [];
    for (let i = 0; i < messages.length; i += this.config.maxBatchSize) {
      batches.push(messages.slice(i, i + this.config.maxBatchSize));
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
      QueueUrl: this.config.queueUrl,
      Entries: entries,
    };

    const command = new SendMessageBatchCommand(input);
    const response = await this.client.send(command);

    // Check for failures
    if (response.Failed && response.Failed.length > 0) {
      const errors = response.Failed.map(
        (f) => `${f.Id}: ${f.Code} - ${f.Message}`,
      ).join(', ');
      throw new Error(`Failed to send ${response.Failed.length} messages: ${errors}`);
    }
  }

  async close(): Promise<void> {
    this.client.destroy();
  }
}
