import amqplib from 'amqplib';
import type { EventConnection } from '../types';
import { EventPublisherType } from '../types';

export interface RabbitMQConnectionConfig {
	url: string;
	exchange?: string;
	exchangeType?: 'topic' | 'direct' | 'fanout' | 'headers';
	exchangeOptions?: amqplib.Options.AssertExchange;
	timeout?: number; // Connection timeout in milliseconds (default: 5000)
}

export class RabbitMQConnection implements EventConnection {
	readonly type = EventPublisherType.RabbitMQ;
	private connection?: amqplib.ChannelModel;
	private channel?: amqplib.Channel;
	private connecting?: Promise<void>;
	private config: Required<
		Pick<RabbitMQConnectionConfig, 'exchange' | 'exchangeType' | 'timeout'>
	> &
		RabbitMQConnectionConfig;

	constructor(config: RabbitMQConnectionConfig) {
		this.config = {
			...config,
			exchange: config.exchange || 'geekmidas.events',
			exchangeType: config.exchangeType || 'topic',
			timeout: config.timeout ?? 5000,
			exchangeOptions: {
				durable: true,
				...config.exchangeOptions,
			},
		};
	}

	/**
	 * Create a RabbitMQConnection from a connection string
	 * Format: rabbitmq://user:pass@host:port/vhost?exchange=name&type=topic&timeout=5000
	 */
	static async fromConnectionString(
		connectionString: string,
	): Promise<RabbitMQConnection> {
		const url = new URL(connectionString);
		const params = url.searchParams;

		// Extract connection URL without query params
		const baseUrl = `amqp://${url.username ? `${url.username}:${url.password}@` : ''}${url.host}${url.pathname}`;

		const timeoutParam = params.get('timeout');
		const config: RabbitMQConnectionConfig = {
			url: baseUrl,
			exchange: params.get('exchange') || 'geekmidas.events',
			exchangeType: (params.get('type') as any) || 'topic',
			timeout: timeoutParam ? Number.parseInt(timeoutParam, 10) : undefined,
		};

		const connection = new RabbitMQConnection(config);
		await connection.connect();
		return connection;
	}

	async connect(): Promise<void> {
		if (this.channel) return;

		// Prevent multiple simultaneous connection attempts
		if (this.connecting) {
			await this.connecting;
			return;
		}

		this.connecting = (async () => {
			try {
				const connection = await amqplib.connect(this.config.url, {
					timeout: this.config.timeout,
				});
				const channel = await connection.createChannel();

				// Assert the exchange exists
				await channel.assertExchange(
					this.config.exchange!,
					this.config.exchangeType!,
					this.config.exchangeOptions,
				);

				// Handle connection errors
				connection.on('error', (_err: Error) => {
					this.cleanup();
				});

				connection.on('close', () => {
					this.cleanup();
				});

				// Only set after successful setup
				this.connection = connection;
				this.channel = channel;
			} catch (error) {
				this.cleanup();
				throw error;
			}
		})();

		await this.connecting;
		this.connecting = undefined;
	}

	async close(): Promise<void> {
		try {
			await this.channel?.close();
			await this.connection?.close();
		} catch (error) {
			// Ignore errors during close
		} finally {
			this.cleanup();
		}
	}

	isConnected(): boolean {
		return !!this.channel;
	}

	private cleanup(): void {
		this.channel = undefined;
		this.connection = undefined;
		this.connecting = undefined;
	}

	/**
	 * Get the underlying channel for publishing/subscribing
	 */
	get amqpChannel(): amqplib.Channel | undefined {
		return this.channel;
	}

	/**
	 * Get the exchange name for this connection
	 */
	get exchangeName(): string {
		return this.config.exchange;
	}

	/**
	 * Get the exchange type for this connection
	 */
	get exchangeType(): string {
		return this.config.exchangeType;
	}
}
