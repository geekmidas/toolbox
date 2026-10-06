import { afterAll, describe, expect, it, vi } from 'vitest';
import {
	LOCALSTACK_URL,
	POSTGRES_PORT,
	RABBITMQ_AUTHORITY,
	RABBITMQ_URL,
} from '../../../testkit/test/ports';
import { EventConnectionFactory } from '../EventConnection';
import { Publisher } from '../Publisher';
import { dropSchemas } from '../pgboss/__tests__/setup';
import { PgBossConnection } from '../pgboss/PgBossConnection';
import { PgBossPublisher } from '../pgboss/PgBossPublisher';
import { PgBossSubscriber } from '../pgboss/PgBossSubscriber';
import { RabbitMQConnection } from '../rabbitmq/RabbitMQConnection';
import { RabbitMQPublisher } from '../rabbitmq/RabbitMQPublisher';
import { RabbitMQSubscriber } from '../rabbitmq/RabbitMQSubscriber';
import { Subscriber } from '../Subscriber';
import { SNSConnection } from '../sns/SNSConnection';
import type { EventConnection, PublishableMessage } from '../types';

/**
 * A connection string is the only thing an app is handed, so the factories
 * are the path every deployed publisher and subscriber is built through. Each
 * broker here is real: a message published through what the factory returned
 * reaches a listener subscribed through what the factory returned.
 */

type Message = PublishableMessage<'order.placed', { id: string }>;

const unique = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const opened: EventConnection[] = [];
const track = <T extends EventConnection>(connection: T) => {
	opened.push(connection);
	return connection;
};

afterAll(async () => {
	for (const connection of opened) await connection.close();
});

describe('rabbitmq://', () => {
	const exchange = `factory-${unique()}`;
	const url = `rabbitmq://${RABBITMQ_AUTHORITY}?exchange=${exchange}&type=topic&timeout=3000`;

	it('builds a connection with the exchange the string names', async () => {
		const connection = track(
			(await EventConnectionFactory.fromConnectionString(
				url,
			)) as RabbitMQConnection,
		);

		expect(connection).toBeInstanceOf(RabbitMQConnection);
		expect(connection.isConnected()).toBe(true);
		expect(connection.exchangeName).toBe(exchange);
		expect(connection.exchangeType).toBe('topic');
	});

	it('delivers through a publisher and subscriber the factories built', async () => {
		const subscriber = await Subscriber.fromConnectionString<Message>(
			`${url}&queueName=factory-${unique()}&prefetch=5` as never,
		);
		expect(subscriber).toBeInstanceOf(RabbitMQSubscriber);
		track(
			(subscriber as unknown as { connection: RabbitMQConnection }).connection,
		);

		const received: Message[] = [];
		await subscriber.subscribe(['order.placed'], async (message) => {
			received.push(message);
		});

		const publisher = await Publisher.fromConnectionString<Message>(
			url as never,
		);
		expect(publisher).toBeInstanceOf(RabbitMQPublisher);
		track(
			(publisher as unknown as { connection: RabbitMQConnection }).connection,
		);

		await publisher.publish([{ type: 'order.placed', payload: { id: 'r1' } }]);

		await vi.waitFor(() =>
			expect(received).toEqual([
				{ type: 'order.placed', payload: { id: 'r1' } },
			]),
		);
	});

	it('shares one connection between a publisher and a subscriber', async () => {
		const connection = track(
			new RabbitMQConnection({
				url: RABBITMQ_URL,
				exchange,
			}),
		);

		expect(await Publisher.fromConnection(connection)).toBeInstanceOf(
			RabbitMQPublisher,
		);
		expect(await Subscriber.fromConnection(connection)).toBeInstanceOf(
			RabbitMQSubscriber,
		);
	});

	it('opens one socket when two callers connect at once', async () => {
		const connection = track(
			new RabbitMQConnection({
				url: RABBITMQ_URL,
				exchange,
			}),
		);

		await Promise.all([connection.connect(), connection.connect()]);
		const channel = connection.amqpChannel;
		await connection.connect();

		expect(connection.amqpChannel).toBe(channel);
	});

	it('notices the broker closing the connection', async () => {
		const connection = track(
			new RabbitMQConnection({
				url: RABBITMQ_URL,
				exchange,
			}),
		);
		await connection.connect();

		await (
			connection as unknown as { connection: { close(): Promise<void> } }
		).connection.close();

		await vi.waitFor(() => expect(connection.isConnected()).toBe(false));
	});
});

describe('pgboss://', () => {
	const schema = `pgboss_factory_${unique()}`;
	const database = `geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
	const url = `pgboss://${database}?schema=${schema}`;

	afterAll(async () => {
		for (const connection of opened.splice(0)) await connection.close();
		await dropSchemas(`postgres://${database}`, [schema]);
	});

	it('delivers through a publisher and subscriber the factories built', async () => {
		const connection = track(
			(await EventConnectionFactory.fromConnectionString(
				url,
			)) as PgBossConnection,
		);
		expect(connection).toBeInstanceOf(PgBossConnection);

		const subscriber = await Subscriber.fromConnectionString<Message>(
			`${url}&batchSize=5&pollingIntervalSeconds=1` as never,
		);
		expect(subscriber).toBeInstanceOf(PgBossSubscriber);
		track(
			(subscriber as unknown as { connection: PgBossConnection }).connection,
		);

		const received: Message[] = [];
		await subscriber.subscribe(['order.placed'], async (message) => {
			received.push(message);
		});

		const publisher = await Publisher.fromConnection<Message>(connection);
		expect(publisher).toBeInstanceOf(PgBossPublisher);
		await publisher.publish([{ type: 'order.placed', payload: { id: 'p1' } }]);
		await publisher.close();

		await vi.waitFor(
			() =>
				expect(received).toEqual([
					{ type: 'order.placed', payload: { id: 'p1' } },
				]),
			{ timeout: 10_000, interval: 200 },
		);

		expect(await Subscriber.fromConnection(connection)).toBeInstanceOf(
			PgBossSubscriber,
		);
		expect(await Publisher.fromConnectionString(url as never)).toBeInstanceOf(
			PgBossPublisher,
		);
	});

	it('starts pg-boss once when two callers connect at once', async () => {
		const connection = track(
			new PgBossConnection({
				connectionString: `postgres://${database}`,
				schema,
			}),
		);

		await Promise.all([connection.connect(), connection.connect()]);
		const boss = connection.instance;
		await connection.connect();

		expect(connection.instance).toBe(boss);
	});
});

describe('sns://', () => {
	it('builds a connection to the topic the string names', async () => {
		const topicArn = 'arn:aws:sns:us-east-1:000000000000:orders';
		const connection = track(
			(await EventConnectionFactory.fromConnectionString(
				`sns://?topicArn=${encodeURIComponent(topicArn)}&endpoint=${encodeURIComponent(LOCALSTACK_URL)}&region=us-east-1`,
			)) as SNSConnection,
		);

		expect(connection).toBeInstanceOf(SNSConnection);
		expect(connection.topicArn).toBe(topicArn);
		expect(connection.isConnected()).toBe(true);
	});
});
