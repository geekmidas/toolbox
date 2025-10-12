import type { EventPublisher, PublishableMessage } from './types';

export class Publisher {
  static async fromConnectionString<
    TMessage extends PublishableMessage<string, any>,
  >(
    connectionStr: EventPublisherConnectionString,
  ): Promise<EventPublisher<TMessage>> {
    const url = new URL(connectionStr);
    switch (url.protocol.replace(':', '')) {
      case EventPublisherType.Basic: {
        const { BasicPublisher } = await import('./basic');
        const { EventEmitter } = await import('node:events');
        return new BasicPublisher<TMessage>(new EventEmitter());
      }
      case EventPublisherType.RabbitMQ: {
        const { RabbitMQPublisher } = await import('./rabbitmq');
        return RabbitMQPublisher.fromConnectionString<TMessage>(connectionStr);
      }
      case EventPublisherType.SQS: {
        const { SQSPublisher } = await import('./sqs');
        return SQSPublisher.fromConnectionString<TMessage>(connectionStr);
      }
      // Future implementations for EventBridge, SNS, Kafka, etc.
      default:
        throw new Error(`Unsupported event publisher type: ${url.protocol}`);
    }
  }
}

export enum EventPublisherType {
  Basic = 'basic',
  EventBridge = 'eventbridge',
  SQS = 'sqs',
  SNS = 'sns',
  Kafka = 'kafka',
  RabbitMQ = 'rabbitmq',
}

export type EventPublisherConnectionString =
  `${EventPublisherType}://${string}`;
