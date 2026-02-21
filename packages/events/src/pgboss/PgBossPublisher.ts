import type { EventPublisher, PublishableMessage } from '../types';
import type { PgBossConnection } from './PgBossConnection';

export class PgBossPublisher<TMessage extends PublishableMessage<string, any>>
	implements EventPublisher<TMessage>
{
	constructor(private connection: PgBossConnection) {}

	/**
	 * Create a PgBossPublisher from a connection string.
	 * Format: pgboss://user:pass@host:5432/database?schema=pgboss
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(connectionString: string): Promise<PgBossPublisher<TMessage>> {
		const { PgBossConnection } = await import('./PgBossConnection');
		const connection =
			await PgBossConnection.fromConnectionString(connectionString);
		return new PgBossPublisher<TMessage>(connection);
	}

	async publish(messages: TMessage[]): Promise<void> {
		if (!this.connection.isConnected()) {
			await this.connection.connect();
		}

		const boss = this.connection.instance;
		if (!boss) {
			throw new Error('PgBoss instance not initialized');
		}

		// Ensure queues exist
		const queueNames = [...new Set(messages.map((m) => m.type))];
		for (const name of queueNames) {
			await boss.createQueue(name);
		}

		// Batch insert — each JobInsert carries its queue name
		await boss.insert(
			messages.map((m) => ({ name: m.type, data: m.payload })),
		);
	}

	async close(): Promise<void> {
		// Publisher doesn't own the connection
	}
}
