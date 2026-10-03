import type { EventPublisher, PublishableMessage } from '../types';
import { PgBossNotStarted } from './errors';
import type { PgBossConnection } from './PgBossConnection';

export interface PgBossPublisherOptions {
	/**
	 * Publishing to a topic: each message is fanned out to every subscriber's
	 * own queue rather than inserted into one shared queue. Without it, a
	 * message goes to the queue named by its type — a work queue, one consumer.
	 */
	topic?: string;
}

/** The pg-boss event a topic's message type is published as. */
export function topicEvent(topic: string, type: string): string {
	return `${topic}/${type}`;
}

export class PgBossPublisher<TMessage extends PublishableMessage<string, any>>
	implements EventPublisher<TMessage>
{
	constructor(
		private connection: PgBossConnection,
		private options: PgBossPublisherOptions = {},
	) {}

	/**
	 * Create a PgBossPublisher from a connection string.
	 * Format: pgboss://user:pass@host:5432/database?schema=pgboss
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(
		connectionString: string,
		options: PgBossPublisherOptions = {},
	): Promise<PgBossPublisher<TMessage>> {
		const { PgBossConnection } = await import('./PgBossConnection');
		const connection =
			await PgBossConnection.fromConnectionString(connectionString);
		return new PgBossPublisher<TMessage>(connection, options);
	}

	async publish(messages: TMessage[]): Promise<void> {
		if (!this.connection.isConnected()) {
			await this.connection.connect();
		}

		const boss = this.connection.instance;
		if (!boss) {
			throw new PgBossNotStarted();
		}

		// A topic: pg-boss copies the job into every queue subscribed to the
		// event — one per subscriber — so each subscriber sees each message.
		// The type rides in the data, because the job is named for the queue.
		const { topic } = this.options;
		if (topic) {
			for (const m of messages) {
				await boss.publish(topicEvent(topic, m.type), {
					type: m.type,
					payload: m.payload,
				});
			}
			return;
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
