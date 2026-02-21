import type { EventSubscriber, PublishableMessage } from '../types';
import type { PgBossConnection } from './PgBossConnection';

export interface PgBossSubscriberOptions {
	batchSize?: number;
	pollingIntervalSeconds?: number;
}

export class PgBossSubscriber<TMessage extends PublishableMessage<string, any>>
	implements EventSubscriber<TMessage>
{
	constructor(
		private connection: PgBossConnection,
		private options: PgBossSubscriberOptions = {},
	) {}

	/**
	 * Create a PgBossSubscriber from a connection string.
	 * Format: pgboss://user:pass@host:5432/database?schema=pgboss&batchSize=5
	 */
	static async fromConnectionString<
		TMessage extends PublishableMessage<string, any>,
	>(connectionString: string): Promise<PgBossSubscriber<TMessage>> {
		const url = new URL(connectionString);
		const params = url.searchParams;

		const { PgBossConnection } = await import('./PgBossConnection');
		const connection =
			await PgBossConnection.fromConnectionString(connectionString);

		const options: PgBossSubscriberOptions = {
			batchSize: params.get('batchSize')
				? Number.parseInt(params.get('batchSize')!, 10)
				: undefined,
			pollingIntervalSeconds: params.get('pollingIntervalSeconds')
				? Number.parseInt(params.get('pollingIntervalSeconds')!, 10)
				: undefined,
		};

		return new PgBossSubscriber<TMessage>(connection, options);
	}

	async subscribe(
		messages: TMessage['type'][],
		listener: (payload: TMessage) => Promise<void>,
	): Promise<void> {
		if (!this.connection.isConnected()) {
			await this.connection.connect();
		}

		const boss = this.connection.instance;
		if (!boss) {
			throw new Error('PgBoss instance not initialized');
		}

		for (const messageType of messages) {
			await boss.createQueue(messageType);
			await boss.work(
				messageType,
				{
					...(this.options.batchSize && {
						batchSize: this.options.batchSize,
					}),
					...(this.options.pollingIntervalSeconds && {
						pollingIntervalSeconds: this.options.pollingIntervalSeconds,
					}),
				},
				async (jobs) => {
					for (const job of jobs) {
						const fullMessage = {
							type: job.name,
							payload: job.data,
						} as TMessage;

						await listener(fullMessage);
					}
				},
			);
		}
	}
}
