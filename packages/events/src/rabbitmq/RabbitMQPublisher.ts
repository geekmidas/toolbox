import amqplib from 'amqplib';
import type { EventPublisher, PublishableMessage } from '../types';

export interface RabbitMQPublisherConfig {
  url: string;
  exchange?: string;
  exchangeType?: 'topic' | 'direct' | 'fanout' | 'headers';
  exchangeOptions?: amqplib.Options.AssertExchange;
  publishOptions?: amqplib.Options.Publish;
}

export class RabbitMQPublisher<TMessage extends PublishableMessage<string, any>>
  implements EventPublisher<TMessage>
{
  private connection?: amqplib.ChannelModel; // amqplib connection
  private channel?: amqplib.Channel; // amqplib channel
  private connecting?: Promise<void>;

  constructor(private config: RabbitMQPublisherConfig) {
    // Set defaults
    this.config.exchange = this.config.exchange || 'events';
    this.config.exchangeType = this.config.exchangeType || 'topic';
    this.config.exchangeOptions = {
      durable: true,
      ...this.config.exchangeOptions,
    };
  }

  /**
   * Create a RabbitMQPublisher from a connection string
   * Format: rabbitmq://user:pass@host:port/vhost?exchange=name&type=topic
   */
  static fromConnectionString<TMessage extends PublishableMessage<string, any>>(
    connectionString: string,
  ): RabbitMQPublisher<TMessage> {
    const url = new URL(connectionString);
    const params = url.searchParams;

    // Extract connection URL without query params
    const baseUrl = `amqp://${url.username ? `${url.username}:${url.password}@` : ''}${url.host}${url.pathname}`;

    const config: RabbitMQPublisherConfig = {
      url: baseUrl,
      exchange: params.get('exchange') || 'geekmidas.events',
      exchangeType: (params.get('type') as any) || 'topic',
    };

    return new RabbitMQPublisher<TMessage>(config);
  }

  private async connect(): Promise<void> {
    if (this.channel) return;

    // Prevent multiple simultaneous connection attempts
    if (this.connecting) {
      await this.connecting;
      return;
    }

    this.connecting = (async () => {
      try {
        const connection = await amqplib.connect(this.config.url);
        const channel = await connection.createChannel();

        // Assert the exchange exists
        await channel.assertExchange(
          this.config.exchange!,
          this.config.exchangeType!,
          this.config.exchangeOptions,
        );

        // Handle connection errors
        connection.on('error', (_err: Error) => {
          // Connection error occurred, cleanup resources
          this.cleanup();
        });

        connection.on('close', () => {
          // Connection closed, cleanup resources
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

  async publish(messages: TMessage[]): Promise<void> {
    await this.connect();

    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const exchange = this.config.exchange!;

    for (const message of messages) {
      const content = Buffer.from(JSON.stringify(message.payload));

      // Use message type as routing key for topic exchanges
      const routingKey = message.type;

      const published = this.channel.publish(exchange, routingKey, content, {
        contentType: 'application/json',
        timestamp: Date.now(),
        type: message.type,
        persistent: true,
        ...this.config.publishOptions,
      });

      // Handle backpressure
      if (!published) {
        await new Promise((resolve) => this.channel!.once('drain', resolve));
      }
    }
  }

  private cleanup(): void {
    this.channel = undefined;
    this.connection = undefined;
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
}
