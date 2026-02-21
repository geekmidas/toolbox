import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { PgBossConnection } from '../PgBossConnection';
import { PgBossPublisher } from '../PgBossPublisher';
import { PgBossSubscriber } from '../PgBossSubscriber';

type TestMessage =
	| PublishableMessage<'user.created', { userId: string }>
	| PublishableMessage<'user.updated', { userId: string; name: string }>;

const POSTGRES_URL = 'postgres://geekmidas:geekmidas@localhost:5432/geekmidas';
const PGBOSS_CONNECTION_STRING =
	'pgboss://geekmidas:geekmidas@localhost:5432/geekmidas?schema=pgboss_test';

const uniqueQueue = () =>
	`test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

describe('PgBossConnection', () => {
	it('should connect and report connected status', async () => {
		const connection = new PgBossConnection({
			connectionString: POSTGRES_URL,
			schema: 'pgboss_conn_test',
		});

		expect(connection.isConnected()).toBe(false);
		expect(connection.instance).toBeUndefined();

		await connection.connect();

		expect(connection.isConnected()).toBe(true);
		expect(connection.instance).toBeDefined();

		await connection.close();

		expect(connection.isConnected()).toBe(false);
	});

	it('should not reconnect if already connected', async () => {
		const connection = new PgBossConnection({
			connectionString: POSTGRES_URL,
			schema: 'pgboss_conn_test2',
		});

		await connection.connect();
		const firstInstance = connection.instance;

		await connection.connect();
		expect(connection.instance).toBe(firstInstance);

		await connection.close();
	});

	it('should parse connection string correctly', async () => {
		const connection = await PgBossConnection.fromConnectionString(
			PGBOSS_CONNECTION_STRING,
		);

		expect(connection.isConnected()).toBe(true);
		expect(connection.instance).toBeDefined();

		await connection.close();
	});
});

describe('PgBossPublisher', () => {
	let connection: PgBossConnection;

	beforeAll(async () => {
		connection = new PgBossConnection({
			connectionString: POSTGRES_URL,
			schema: 'pgboss_pub_test',
		});
		await connection.connect();
	});

	afterAll(async () => {
		await connection.close();
	});

	it('should publish messages without errors', async () => {
		const publisher = new PgBossPublisher<TestMessage>(connection);

		await publisher.publish([
			{ type: uniqueQueue() as any, payload: { userId: '1' } },
		]);
	});

	it('should publish multiple messages with different types', async () => {
		const publisher = new PgBossPublisher<TestMessage>(connection);
		const queue1 = uniqueQueue() as any;
		const queue2 = uniqueQueue() as any;

		await publisher.publish([
			{ type: queue1, payload: { userId: '1' } },
			{ type: queue1, payload: { userId: '2' } },
			{ type: queue2, payload: { userId: '3', name: 'Alice' } },
		]);
	});

	it('should create publisher from connection string', async () => {
		const publisher = await PgBossPublisher.fromConnectionString<TestMessage>(
			PGBOSS_CONNECTION_STRING,
		);

		expect(publisher).toBeInstanceOf(PgBossPublisher);
	});
});

describe('PgBossSubscriber', () => {
	let connection: PgBossConnection;

	beforeAll(async () => {
		connection = new PgBossConnection({
			connectionString: POSTGRES_URL,
			schema: 'pgboss_sub_test',
		});
		await connection.connect();
	});

	afterAll(async () => {
		await connection.close();
	});

	it('should receive published messages', async () => {
		const queueName = uniqueQueue() as any;
		const publisher = new PgBossPublisher<TestMessage>(connection);
		const subscriber = new PgBossSubscriber<TestMessage>(connection, {
			pollingIntervalSeconds: 1,
		});

		const received: TestMessage[] = [];

		await subscriber.subscribe([queueName], async (message) => {
			received.push(message);
		});

		await publisher.publish([{ type: queueName, payload: { userId: '42' } }]);

		// Wait for pg-boss to poll and deliver
		await new Promise((resolve) => setTimeout(resolve, 3000));

		expect(received.length).toBe(1);
		expect(received[0]).toEqual({
			type: queueName,
			payload: { userId: '42' },
		});
	});

	it('should subscribe to multiple message types', async () => {
		const queue1 = uniqueQueue() as any;
		const queue2 = uniqueQueue() as any;
		const publisher = new PgBossPublisher<TestMessage>(connection);
		const subscriber = new PgBossSubscriber<TestMessage>(connection, {
			pollingIntervalSeconds: 1,
		});

		const received: TestMessage[] = [];

		await subscriber.subscribe([queue1, queue2], async (message) => {
			received.push(message);
		});

		await publisher.publish([
			{ type: queue1, payload: { userId: '1' } },
			{ type: queue2, payload: { userId: '2', name: 'Bob' } },
		]);

		await new Promise((resolve) => setTimeout(resolve, 3000));

		expect(received.length).toBe(2);
		expect(received.map((m) => m.payload)).toEqual(
			expect.arrayContaining([{ userId: '1' }, { userId: '2', name: 'Bob' }]),
		);
	});

	it('should create subscriber from connection string with options', async () => {
		const subscriber = await PgBossSubscriber.fromConnectionString<TestMessage>(
			`${PGBOSS_CONNECTION_STRING}&batchSize=10`,
		);

		expect(subscriber).toBeInstanceOf(PgBossSubscriber);
	});
});
