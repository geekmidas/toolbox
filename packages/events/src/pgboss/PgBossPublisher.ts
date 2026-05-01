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

		// Group jobs by queue name (v11+ requires per-queue insert calls)
		const groups = new Map<string, { data: TMessage['payload'] }[]>();
		for (const m of messages) {
			const list = groups.get(m.type) ?? [];
			list.push({ data: m.payload });
			groups.set(m.type, list);
		}

		for (const [name, jobs] of groups) {
			await boss.createQueue(name);
			await boss.insert(name, jobs);
		}
	}

	async close(): Promise<void> {
		// Publisher doesn't own the connection
	}
}
