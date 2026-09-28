import type { EventConnection } from './types';
import { EventPublisherType, UnsupportedEventTransport } from './types';

export class EventConnectionFactory {
	/**
	 * Create an EventConnection from a connection string
	 * Dynamically imports the appropriate connection implementation
	 */
	static async fromConnectionString(
		connectionStr: string,
	): Promise<EventConnection> {
		const url = new URL(connectionStr);
		const protocol = url.protocol.replace(':', '') as EventPublisherType;

		switch (protocol) {
			case EventPublisherType.Basic: {
				const { BasicConnection } = await import('./basic');
				return BasicConnection.fromConnectionString(connectionStr);
			}
			case EventPublisherType.RabbitMQ: {
				const { RabbitMQConnection } = await import('./rabbitmq');
				return RabbitMQConnection.fromConnectionString(connectionStr);
			}
			case EventPublisherType.SQS: {
				const { SQSConnection } = await import('./sqs');
				return SQSConnection.fromConnectionString(connectionStr);
			}
			case EventPublisherType.SNS: {
				const { SNSConnection } = await import('./sns');
				return SNSConnection.fromConnectionString(connectionStr);
			}
			case EventPublisherType.PgBoss: {
				const { PgBossConnection } = await import('./pgboss');
				return PgBossConnection.fromConnectionString(connectionStr);
			}
			default:
				throw new UnsupportedEventTransport(protocol, 'connection');
		}
	}
}

export type { EventConnection } from './types';
export { EventPublisherType } from './types';
