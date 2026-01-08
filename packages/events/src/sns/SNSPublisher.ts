import { PublishCommand } from '@aws-sdk/client-sns';
import type { EventPublisher, PublishableMessage } from '../types';
import type { SNSConnection } from './SNSConnection';

export interface SNSPublisherOptions {
	// Optional publisher-specific options
}

export class SNSPublisher<TMessage extends PublishableMessage<string, any>>
	implements EventPublisher<TMessage>
{
	constructor(
		private connection: SNSConnection,
		private options: SNSPublisherOptions = {},
	) {}

	/**
	 * Create an SNSPublisher from a connection string
	 * Format: sns://?topicArn=arn:aws:sns:region:account:topic&region=us-east-1&endpoint=http://localhost:4566
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(connectionString: string): Promise<SNSPublisher<TMessage>> {
		const { SNSConnection } = await import('./SNSConnection');
		const connection =
			await SNSConnection.fromConnectionString(connectionString);

		return new SNSPublisher<TMessage>(connection);
	}

	async publish(messages: TMessage[]): Promise<void> {
		if (messages.length === 0) return;

		if (!this.connection.isConnected()) {
			await this.connection.connect();
		}

		// Publish all messages
		await Promise.all(messages.map((message) => this.publishMessage(message)));
	}

	private async publishMessage(message: TMessage): Promise<void> {
		const command = new PublishCommand({
			TopicArn: this.connection.topicArn,
			Message: JSON.stringify({
				type: message.type,
				payload: message.payload,
			}),
			MessageAttributes: {
				type: {
					DataType: 'String',
					StringValue: message.type,
				},
			},
		});

		await this.connection.snsClient.send(command);
	}

	async close(): Promise<void> {
		// Publisher doesn't own the connection
		// Connection should be closed by whoever created it
	}
}
