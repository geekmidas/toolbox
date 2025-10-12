import type {
  EventConnection,
  EventSubscriber,
  PublishableMessage,
} from './types';
import { EventPublisherType } from './types';

export class Subscriber {
  /**
   * Create a subscriber from a connection string
   * This creates both a connection and a subscriber
   */
  static async fromConnectionString<
    TMessage extends PublishableMessage<string, any>,
  >(
    connectionStr: EventSubscriberConnectionString,
  ): Promise<EventSubscriber<TMessage>> {
    const url = new URL(connectionStr);
    switch (url.protocol.replace(':', '')) {
      case EventPublisherType.Basic: {
        const { BasicConnection, BasicSubscriber } = await import('./basic');
        const connection = await BasicConnection.fromConnectionString(
          connectionStr,
        );
        return new BasicSubscriber<TMessage>(connection);
      }
      case EventPublisherType.RabbitMQ: {
        const { RabbitMQSubscriber } = await import('./rabbitmq');
        return RabbitMQSubscriber.fromConnectionString<TMessage>(
          connectionStr,
        );
      }
      case EventPublisherType.SNS: {
        const { SNSSubscriber } = await import('./sns');
        return SNSSubscriber.fromConnectionString<TMessage>(connectionStr);
      }
      case EventPublisherType.SQS: {
        const url = new URL(connectionStr);
        const topicArn = url.searchParams.get('topicArn');

        // If topicArn is present, use managed SNS→SQS subscription
        if (topicArn) {
          const { SNSSubscriber } = await import('./sns');
          // Convert SQS connection string to SNS connection string
          const snsConnectionStr = connectionStr.replace('sqs://', 'sns://');
          return SNSSubscriber.fromConnectionString<TMessage>(snsConnectionStr);
        }

        // Direct SQS subscriber
        const { SQSSubscriber } = await import('./sqs');
        const { SQSConnection } = await import('./sqs');
        const connection = await SQSConnection.fromConnectionString(
          connectionStr,
        );
        return new SQSSubscriber<TMessage>(connection);
      }
      // Future implementations for EventBridge, Kafka, etc.
      default:
        throw new Error(`Unsupported event subscriber type: ${url.protocol}`);
    }
  }

  /**
   * Create a subscriber from an existing connection
   * This allows sharing connections between publishers and subscribers
   */
  static async fromConnection<
    TMessage extends PublishableMessage<string, any>,
  >(connection: EventConnection): Promise<EventSubscriber<TMessage>> {
    switch (connection.type) {
      case EventPublisherType.Basic: {
        const { BasicSubscriber } = await import('./basic');
        const { BasicConnection } = await import('./basic');
        return new BasicSubscriber<TMessage>(
          connection as InstanceType<typeof BasicConnection>,
        );
      }
      case EventPublisherType.RabbitMQ: {
        const { RabbitMQSubscriber } = await import('./rabbitmq');
        const { RabbitMQConnection } = await import('./rabbitmq');
        return new RabbitMQSubscriber<TMessage>(
          connection as InstanceType<typeof RabbitMQConnection>,
        );
      }
      case EventPublisherType.SNS: {
        const { SNSSubscriber } = await import('./sns');
        const { SNSConnection } = await import('./sns');
        return new SNSSubscriber<TMessage>(
          connection as InstanceType<typeof SNSConnection>,
        );
      }
      case EventPublisherType.SQS: {
        const { SQSSubscriber } = await import('./sqs');
        const { SQSConnection } = await import('./sqs');
        return new SQSSubscriber<TMessage>(
          connection as InstanceType<typeof SQSConnection>,
        );
      }
      default:
        throw new Error(`Unsupported connection type: ${connection.type}`);
    }
  }
}

export type EventSubscriberConnectionString =
  `${EventPublisherType}://${string}`;
