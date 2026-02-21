import type {
	EventConnection,
	EventPublisher,
	PublishableMessage,
} from './types';
import { EventPublisherType } from './types';

export class Publisher {
	/**
	 * Create a publisher from a connection string
	 * This creates both a connection and a publisher
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(
		connectionStr: EventPublisherConnectionString,
	): Promise<EventPublisher<TMessage>> {
		const url = new URL(connectionStr);
		switch (url.protocol.replace(':', '')) {
			case EventPublisherType.Basic: {
				const { BasicConnection, BasicPublisher } = await import('./basic');
				const connection =
					await BasicConnection.fromConnectionString(connectionStr);
				return new BasicPublisher<TMessage>(connection);
			}
			case EventPublisherType.RabbitMQ: {
				const { RabbitMQPublisher } = await import('./rabbitmq');
				return RabbitMQPublisher.fromConnectionString<TMessage>(connectionStr);
			}
			case EventPublisherType.SQS: {
				const { SQSPublisher } = await import('./sqs');
				return SQSPublisher.fromConnectionString<TMessage>(connectionStr);
			}
			case EventPublisherType.SNS: {
				const { SNSPublisher } = await import('./sns');
				return SNSPublisher.fromConnectionString<TMessage>(connectionStr);
			}
			case EventPublisherType.PgBoss: {
				const { PgBossPublisher } = await import('./pgboss');
				return PgBossPublisher.fromConnectionString<TMessage>(connectionStr);
			}
			// Future implementations for EventBridge, Kafka, etc.
			default:
				throw new Error(`Unsupported event publisher type: ${url.protocol}`);
		}
	}

	/**
	 * Create a publisher from an existing connection
	 * This allows sharing connections between publishers and subscribers
	 */
	static async fromConnection<TMessage extends PublishableMessage<string, any>>(
		connection: EventConnection,
	): Promise<EventPublisher<TMessage>> {
		switch (connection.type) {
			case EventPublisherType.Basic: {
				const { BasicPublisher } = await import('./basic');
				const { BasicConnection } = await import('./basic');
				return new BasicPublisher<TMessage>(
					connection as InstanceType<typeof BasicConnection>,
				);
			}
			case EventPublisherType.RabbitMQ: {
				const { RabbitMQPublisher } = await import('./rabbitmq');
				const { RabbitMQConnection } = await import('./rabbitmq');
				return new RabbitMQPublisher<TMessage>(
					connection as InstanceType<typeof RabbitMQConnection>,
				);
			}
			case EventPublisherType.SQS: {
				const { SQSPublisher } = await import('./sqs');
				const { SQSConnection } = await import('./sqs');
				return new SQSPublisher<TMessage>(
					connection as InstanceType<typeof SQSConnection>,
				);
			}
			case EventPublisherType.SNS: {
				const { SNSPublisher } = await import('./sns');
				const { SNSConnection } = await import('./sns');
				return new SNSPublisher<TMessage>(
					connection as InstanceType<typeof SNSConnection>,
				);
			}
			case EventPublisherType.PgBoss: {
				const { PgBossPublisher } = await import('./pgboss');
				const { PgBossConnection } = await import('./pgboss');
				return new PgBossPublisher<TMessage>(
					connection as InstanceType<typeof PgBossConnection>,
				);
			}
			default:
				throw new Error(`Unsupported connection type: ${connection.type}`);
		}
	}
}

export type EventPublisherConnectionString =
	`${EventPublisherType}://${string}`;
