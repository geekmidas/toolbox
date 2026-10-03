import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import type { PublishableMessage } from '../../types';
import { PgBossSubscriptionNeedsName } from '../errors';
import { PgBossConnection } from '../PgBossConnection';
import { PgBossPublisher } from '../PgBossPublisher';
import { PgBossSubscriber } from '../PgBossSubscriber';
import { dropSchemas } from './setup';

type UserEvent = PublishableMessage<'user.created', { userId: string }>;

const POSTGRES_URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const SCHEMA = 'pgboss_fanout_test';

/**
 * A topic on pg-boss: every subscriber sees every message.
 *
 * Before, a topic's message went into one queue named for its type and every
 * subscriber worked that queue — so two subscribers *competed*, each event
 * reaching one of them, and two topics with an event of the same name shared
 * a queue.
 */
describe('pg-boss topic fan-out', () => {
	let connection: PgBossConnection;

	beforeAll(async () => {
		await dropSchemas(POSTGRES_URL, [SCHEMA]);
		connection = new PgBossConnection({
			connectionString: POSTGRES_URL,
			schema: SCHEMA,
		});
		await connection.connect();
	});

	afterAll(async () => {
		await connection.close();
	});

	const until = async (check: () => boolean) => {
		for (let i = 0; i < 100 && !check(); i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	};

	const subscribe = async (
		topic: string,
		subscription: string,
		into: UserEvent[],
	) => {
		const subscriber = new PgBossSubscriber<UserEvent>(connection, {
			topic,
			subscription,
			pollingIntervalSeconds: 0.5,
		});
		await subscriber.subscribe(['user.created'], async (message) => {
			into.push(message);
		});
	};

	it('delivers each message to every subscriber, and to no other topic', async () => {
		const notifications: UserEvent[] = [];
		const audit: UserEvent[] = [];
		const otherTopic: UserEvent[] = [];
		await subscribe('users', 'notifications', notifications);
		await subscribe('users', 'audit', audit);
		// Same event type, different topic.
		await subscribe('admins', 'notifications', otherTopic);

		await new PgBossPublisher<UserEvent>(connection, {
			topic: 'users',
		}).publish([{ type: 'user.created', payload: { userId: 'u-1' } }]);

		await until(() => notifications.length > 0 && audit.length > 0);
		// Give a wrongly-routed copy the chance to arrive before saying it didn't.
		await new Promise((resolve) => setTimeout(resolve, 1000));

		const event = { type: 'user.created', payload: { userId: 'u-1' } };
		expect(notifications).toEqual([event]);
		expect(audit).toEqual([event]);
		expect(otherTopic).toEqual([]);
	});

	it('needs a subscription name, which its queue is named for', async () => {
		const subscriber = new PgBossSubscriber<UserEvent>(connection, {
			topic: 'users',
		});

		await expect(
			subscriber.subscribe(['user.created'], async () => {}),
		).rejects.toBeInstanceOf(PgBossSubscriptionNeedsName);
	});
});
