import type amqplib from 'amqplib';
import type { EventSubscriber, PublishableMessage } from '../types';
import type { RabbitMQConnection } from './RabbitMQConnection';

export interface RabbitMQSubscriberOptions {
	queueName?: string; // If not provided, a unique queue will be generated
	queueOptions?: amqplib.Options.AssertQueue;
	consumeOptions?: amqplib.Options.Consume;
	prefetch?: number; // Number of messages to prefetch (default: 1)
}

export class RabbitMQSubscriber<
	TMessage extends PublishableMessage<string, any>,
> implements EventSubscriber<TMessage>
{
	constructor(
		private connection: RabbitMQConnection,
		private options: RabbitMQSubscriberOptions = {},
	) {}

	/**
	 * Create a RabbitMQSubscriber from a connection string
	 * Format: rabbitmq://user:pass@host:port/vhost?exchange=name&type=topic&queueName=myqueue&prefetch=10
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(connectionString: string): Promise<RabbitMQSubscriber<TMessage>> {
		const url = new URL(connectionString);
		const params = url.searchParams;

		const { RabbitMQConnection } = await import('./RabbitMQConnection');
		const connection =
			await RabbitMQConnection.fromConnectionString(connectionString);

		const options: RabbitMQSubscriberOptions = {
			queueName: params.get('queueName') || undefined,
			prefetch: params.get('prefetch')
				? Number.parseInt(params.get('prefetch')!, 10)
				: undefined,
		};

		return new RabbitMQSubscriber<TMessage>(connection, options);
	}

	async subscribe(
		messages: TMessage['type'][],
		listener: (payload: TMessage) => Promise<void>,
	): Promise<void> {
		if (!this.connection.isConnected()) {
			await this.connection.connect();
		}

		const channel = this.connection.amqpChannel;
		if (!channel) {
			throw new Error('Channel not initialized');
		}

		const exchange = this.connection.exchangeName;

		// Set prefetch if specified
		if (this.options.prefetch) {
			await channel.prefetch(this.options.prefetch);
		}

		// Assert queue
		const queueName = this.options.queueName || '';
		const queueOptions: amqplib.Options.AssertQueue = {
			durable: true,
			...this.options.queueOptions,
		};

		const { queue } = await channel.assertQueue(queueName, queueOptions);

		// Bind queue to exchange for each message type
		for (const messageType of messages) {
			await channel.bindQueue(queue, exchange, messageType);
		}

		// Consume messages
		await channel.consume(
			queue,
			async (msg) => {
				if (!msg) return;

				try {
					// Parse message payload
					const content = msg.content.toString();
					const payload = JSON.parse(content);

					// Get message type from properties
					const messageType = msg.properties.type;

					// Reconstruct full message
					const fullMessage: TMessage = {
						type: messageType,
						payload,
					} as TMessage;

					// Call listener
					await listener(fullMessage);

					// Ack message
					channel.ack(msg);
				} catch (_error) {
					channel.nack(msg, false, true);
				}
			},
			this.options.consumeOptions,
		);
	}
}
