import {
  CreateQueueCommand,
  DeleteQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SetQueueAttributesCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { SubscribeCommand, UnsubscribeCommand } from '@aws-sdk/client-sns';
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
 * SNS Subscriber - receives messages via SQS queue subscribed to SNS topic
 *
 * This subscriber automatically:
 * 1. Creates an SQS queue (or uses existing one)
 * 2. Subscribes the queue to the SNS topic
 * 3. Receives messages from the queue (push-based via SNS)
 * 4. Processes and deletes messages
 */
export class SNSSubscriber<TMessage extends PublishableMessage<string, any>>
  implements EventSubscriber<TMessage>
{
  private sqsClient: SQSClient;
  private queueUrl?: string;
  private queueArn?: string;
  private subscriptionArn?: string;
  private polling = false;
  private messageTypes: Set<TMessage['type']> = new Set();
  private listener?: (payload: TMessage) => Promise<void>;
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
      deleteQueueOnClose:
        options.deleteQueueOnClose ?? !options.queueName, // Delete auto-generated queues
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
    this.messageTypes = new Set(messages);
    this.listener = listener;

    // Setup SQS queue and SNS subscription
    await this.setupQueue();
    await this.subscribeToTopic();

    // Start polling
    this.polling = true;
    this.poll();
  }

  /**
   * Stop receiving messages and clean up resources
   */
  async stop(): Promise<void> {
    this.polling = false;

    // Unsubscribe from topic
    if (this.subscriptionArn) {
      try {
        const command = new UnsubscribeCommand({
          SubscriptionArn: this.subscriptionArn,
        });
        await this.connection.snsClient.send(command);
      } catch (error) {
        console.error('Error unsubscribing:', error);
      }
    }

    // Delete queue if configured
    if (this.queueUrl && this.options.deleteQueueOnClose) {
      try {
        const command = new DeleteQueueCommand({
          QueueUrl: this.queueUrl,
        });
        await this.sqsClient.send(command);
      } catch (error) {
        console.error('Error deleting queue:', error);
      }
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
      throw new Error(
        'Queue must exist or createQueue option must be true',
      );
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

  private async poll(): Promise<void> {
    while (this.polling) {
      try {
        const command = new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: this.options.maxMessages,
          WaitTimeSeconds: this.options.waitTimeSeconds,
          MessageAttributeNames: ['All'],
        });

        const response = await this.sqsClient.send(command);

        if (response.Messages && response.Messages.length > 0) {
          await this.processMessages(response.Messages);
        }
      } catch (error) {
        console.error('Error polling SQS:', error);
        await this.sleep(1000);
      }
    }
  }

  private async processMessages(messages: Message[]): Promise<void> {
    for (const message of messages) {
      try {
        if (!message.Body) continue;

        // Parse SNS notification wrapper
        const snsNotification = JSON.parse(message.Body);

        // Extract the actual message from SNS
        const actualMessage = JSON.parse(snsNotification.Message);
        const messageType =
          snsNotification.MessageAttributes?.type?.Value ||
          actualMessage.type;

        // Check if we're subscribed to this message type
        if (
          messageType &&
          this.messageTypes.has(messageType as TMessage['type'])
        ) {
          // Call listener
          if (this.listener) {
            await this.listener(actualMessage as TMessage);
          }

          // Delete message after successful processing
          await this.deleteMessage(message.ReceiptHandle!);
        }
      } catch (error) {
        console.error('Error processing message:', error);
        // Message will become visible again
      }
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      });
      await this.sqsClient.send(command);
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
