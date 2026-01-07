import { SubscribeCommand, UnsubscribeCommand } from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SQSConnection } from '../sqs/SQSConnection';
import { SQSSubscriber } from '../sqs/SQSSubscriber';
import type { EventSubscriber, PublishableMessage } from '../types';
import type { SNSConnection } from './SNSConnection';

export interface SNSSubscriberOptions {
  queueName?: string; // Optional queue name (defaults to auto-generated)
  createQueue?: boolean; // Auto-create SQS queue (default: true)
  deleteQueueOnClose?: boolean; // Delete queue when subscriber closes (default: false for named queues, true for auto-generated)
  waitTimeSeconds?: number; // SQS long polling (default: 20)
  maxMessages?: number; // Max messages per poll (default: 10)
}

/**
 * SNS Subscriber - receives push-based messages from SNS via SQS queue
 *
 * Architecture:
 * SNS Topic → (push) → SQS Queue → Subscriber
 *
 * This subscriber automatically:
 * 1. Creates an SQS queue (or uses existing one)
 * 2. Subscribes the queue to the SNS topic
 * 3. Receives messages pushed from SNS to the queue
 * 4. Filters messages by topic ARN and message type
 * 5. Processes and acknowledges messages
 *
 * Note: While SQS long-polling is used internally to receive messages,
 * this is an implementation detail of the SNS push delivery mechanism.
 * Messages are pushed from SNS to SQS, and we receive those pushed messages.
 */
export class SNSSubscriber<TMessage extends PublishableMessage<string, any>>
  implements EventSubscriber<TMessage>
{
  private sqsClient: SQSClient;
  private queueUrl?: string;
  private queueArn?: string;
  private subscriptionArn?: string;
  private sqsSubscriber?: SQSSubscriber<TMessage>;
  private options: Required<SNSSubscriberOptions>;

  constructor(
    private connection: SNSConnection,
    options: SNSSubscriberOptions = {},
  ) {
    this.options = {
      queueName:
        options.queueName ||
        `sns-sub-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      createQueue: options.createQueue ?? true,
      deleteQueueOnClose: options.deleteQueueOnClose ?? !options.queueName, // Delete auto-generated queues
      waitTimeSeconds: options.waitTimeSeconds ?? 20,
      maxMessages: options.maxMessages ?? 10,
    };

    // Create SQS client with same config as SNS
    this.sqsClient = new SQSClient({
      region: (this.connection as any).config.region,
      endpoint: (this.connection as any).config.endpoint,
      credentials: (this.connection as any).config.credentials,
    });
  }

  /**
   * Create an SNSSubscriber from a connection string
   * Format: sns://?topicArn=...&queueName=myqueue&region=us-east-1
   */
  static async fromConnectionString<
    TMessage extends PublishableMessage<string, any>,
  >(connectionString: string): Promise<SNSSubscriber<TMessage>> {
    const url = new URL(connectionString);
    const params = url.searchParams;

    const { SNSConnection } = await import('./SNSConnection');
    const connection =
      await SNSConnection.fromConnectionString(connectionString);

    const options: SNSSubscriberOptions = {
      queueName: params.get('queueName') || undefined,
      createQueue: params.get('createQueue') !== 'false',
      deleteQueueOnClose: params.get('deleteQueueOnClose') === 'true',
      waitTimeSeconds: params.get('waitTimeSeconds')
        ? Number.parseInt(params.get('waitTimeSeconds')!, 10)
        : undefined,
    };

    return new SNSSubscriber<TMessage>(connection, options);
  }

  async subscribe(
    messages: TMessage['type'][],
    listener: (payload: TMessage) => Promise<void>,
  ): Promise<void> {
    // Setup SQS queue and SNS subscription
    await this.setupQueue();
    await this.subscribeToTopic();

    // Create SQS connection for the subscriber
    const sqsConnection = new SQSConnection({
      queueUrl: this.queueUrl!,
      region: (this.connection as any).config.region,
      endpoint: (this.connection as any).config.endpoint,
      credentials: (this.connection as any).config.credentials,
    });
    await sqsConnection.connect();

    // Use SQSSubscriber to receive messages, with topic filtering
    this.sqsSubscriber = new SQSSubscriber<TMessage>(sqsConnection, {
      waitTimeSeconds: this.options.waitTimeSeconds,
      maxMessages: this.options.maxMessages,
      expectedTopicArn: this.connection.topicArn,
    });

    await this.sqsSubscriber.subscribe(messages, listener);
  }

  /**
   * Stop receiving messages and clean up resources
   */
  async stop(): Promise<void> {
    // Stop SQS subscriber
    if (this.sqsSubscriber) {
      this.sqsSubscriber.stop();
    }

    // Unsubscribe from topic
    if (this.subscriptionArn) {
      try {
        const command = new UnsubscribeCommand({
          SubscriptionArn: this.subscriptionArn,
        });
        await this.connection.snsClient.send(command);
      } catch (error) {}
    }

    // Delete queue if configured
    if (this.queueUrl && this.options.deleteQueueOnClose) {
      try {
        const command = new DeleteQueueCommand({
          QueueUrl: this.queueUrl,
        });
        await this.sqsClient.send(command);
      } catch (error) {}
    }

    this.sqsClient.destroy();
  }

  private async setupQueue(): Promise<void> {
    if (this.options.createQueue) {
      // Create queue
      const createCommand = new CreateQueueCommand({
        QueueName: this.options.queueName,
      });
      const response = await this.sqsClient.send(createCommand);
      this.queueUrl = response.QueueUrl!;
    } else {
      throw new Error('Queue must exist or createQueue option must be true');
    }

    // Get queue ARN
    const attrsCommand = new GetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      AttributeNames: ['QueueArn'],
    });
    const attrsResponse = await this.sqsClient.send(attrsCommand);
    this.queueArn = attrsResponse.Attributes?.QueueArn!;

    // Set queue policy to allow SNS
    await this.setQueuePolicy();
  }

  private async setQueuePolicy(): Promise<void> {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: 'SQS:SendMessage',
          Resource: this.queueArn,
          Condition: {
            ArnEquals: {
              'aws:SourceArn': this.connection.topicArn,
            },
          },
        },
      ],
    };

    const command = new SetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      Attributes: {
        Policy: JSON.stringify(policy),
      },
    });

    await this.sqsClient.send(command);
  }

  private async subscribeToTopic(): Promise<void> {
    const command = new SubscribeCommand({
      TopicArn: this.connection.topicArn,
      Protocol: 'sqs',
      Endpoint: this.queueArn,
    });

    const response = await this.connection.snsClient.send(command);
    this.subscriptionArn = response.SubscriptionArn!;
  }
}
