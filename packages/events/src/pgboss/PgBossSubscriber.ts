import { consumeTraced, withoutTraceKey } from '../telemetry';
import type { EventSubscriber, PublishableMessage } from '../types';
import { PgBossNotStarted, PgBossSubscriptionNeedsName } from './errors';
import type { PgBossConnection } from './PgBossConnection';
import { topicEvent } from './PgBossPublisher';

export interface PgBossSubscriberOptions {
	batchSize?: number;
	pollingIntervalSeconds?: number;
	/**
	 * Subscribing to a topic. Each subscriber then drains a queue of its own,
	 * `<topic>/<subscription>`, bound to the events it names — so every
	 * subscriber sees every message, and replicas of one subscriber share it.
	 * Without it, messages are drained from the queue named by their type:
	 * work shared among whoever drains it.
	 */
	topic?: string;
	/** The subscriber's own name on the topic. Required with `topic`. */
	subscription?: string;
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
			throw new PgBossNotStarted();
		}

		const work = {
			...(this.options.batchSize && { batchSize: this.options.batchSize }),
			...(this.options.pollingIntervalSeconds && {
				pollingIntervalSeconds: this.options.pollingIntervalSeconds,
			}),
		};

		const { topic, subscription } = this.options;
		if (topic) {
			if (!subscription) throw new PgBossSubscriptionNeedsName(topic);

			const queue = topicEvent(topic, subscription);
			await boss.createQueue(queue);
			for (const type of messages) {
				await boss.subscribe(topicEvent(topic, type), queue);
			}
			await boss.work<{ type: string; payload: unknown }>(
				queue,
				work,
				async (jobs) => {
					for (const job of jobs) {
						const { data, carrier } = withoutTraceKey(job.data);
						await consumeTraced(
							{
								system: 'pgboss',
								destination: topic,
								type: data.type,
								messageId: job.id,
							},
							carrier,
							() =>
								listener({
									type: data.type,
									payload: data.payload,
								} as TMessage),
						);
					}
				},
			);
			return;
		}

		for (const messageType of messages) {
			await boss.createQueue(messageType);
			await boss.work(messageType, work, async (jobs) => {
				for (const job of jobs) {
					// The trace context is taken out of the data here, so the
					// handler's payload is exactly what was published.
					const { data, carrier } = withoutTraceKey(job.data);
					await consumeTraced(
						{
							system: 'pgboss',
							destination: messageType,
							type: job.name,
							messageId: job.id,
						},
						carrier,
						() => listener({ type: job.name, payload: data } as TMessage),
					);
				}
			});
		}
	}
}
