import type amqplib from 'amqplib';
import type { EventPublisher, PublishableMessage } from '../types';
import type { RabbitMQConnection } from './RabbitMQConnection';

export interface RabbitMQPublisherOptions {
	publishOptions?: amqplib.Options.Publish;
}

export class RabbitMQPublisher<TMessage extends PublishableMessage<string, any>>
	implements EventPublisher<TMessage>
{
	constructor(
		private connection: RabbitMQConnection,
		private options: RabbitMQPublisherOptions = {},
	) {}

	/**
	 * Create a RabbitMQPublisher from a connection string
	 * Format: rabbitmq://user:pass@host:port/vhost?exchange=name&type=topic&timeout=5000
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(connectionString: string): Promise<RabbitMQPublisher<TMessage>> {
		const { RabbitMQConnection } = await import('./RabbitMQConnection');
		const connection =
			await RabbitMQConnection.fromConnectionString(connectionString);
		return new RabbitMQPublisher<TMessage>(connection);
	}

	async publish(messages: TMessage[]): Promise<void> {
		if (!this.connection.isConnected()) {
			await this.connection.connect();
		}

		const channel = this.connection.amqpChannel;
		if (!channel) {
			throw new Error('Channel not initialized');
		}

		const exchange = this.connection.exchangeName;

		for (const message of messages) {
			const content = Buffer.from(JSON.stringify(message.payload));

			// Use message type as routing key for topic exchanges
			const routingKey = message.type;

			const published = channel.publish(exchange, routingKey, content, {
				contentType: 'application/json',
				timestamp: Date.now(),
				type: message.type,
				persistent: true,
				...this.options.publishOptions,
			});

			// Handle backpressure
			if (!published) {
				await new Promise((resolve) => channel.once('drain', resolve));
			}
		}
	}

	async close(): Promise<void> {
		// Publisher doesn't own the connection
		// Connection should be closed by whoever created it
	}
}
