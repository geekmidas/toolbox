import {
	CreateTopicCommand,
	DeleteTopicCommand,
	SNSClient,
} from '@aws-sdk/client-sns';
import {
	CreateQueueCommand,
	DeleteQueueCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	LOCALSTACK_URL,
	POSTGRES_PORT,
	RABBITMQ_AUTHORITY,
} from '../../../testkit/test/ports';
import { basicEventsDriver } from '../basic/driver';
import { Publisher } from '../Publisher';
import { dropSchemas } from '../pgboss/__tests__/setup';
import { pgbossEventsDriver } from '../pgboss/driver';
import { rabbitmqEventsDriver } from '../rabbitmq/driver';
import {
	type EventsDriver,
	registerEventsDriver,
	registeredEventsSchemes,
} from '../registry';
import { Subscriber } from '../Subscriber';
import { snsEventsDriver } from '../sns/driver';
import { sqsEventsDriver } from '../sqs/driver';
import { build as sqsUrl } from '../sqs/sqsUrl';
import type { EventConnection, PublishableMessage } from '../types';
import { clearEventsDrivers } from './__helpers__/drivers';

/**
 * Each broker's driver, registered alone — as an entry point registers only
 * the broker its target uses — publishing to and consuming from the real
 * broker: Postgres for pg-boss, the AWS emulator for SNS and SQS, RabbitMQ.
 */

type Message = PublishableMessage<'order.placed', { id: string }>;

const unique = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const REGION = 'us-east-1';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterAll(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
});

beforeEach(() => clearEventsDrivers());

/** Subscribe, publish, and see the one message arrive — through the driver alone. */
async function roundTrip(
	driver: EventsDriver,
	connectionString: string,
	subscriberString = connectionString,
): Promise<void> {
	registerEventsDriver(driver);
	expect(registeredEventsSchemes()).toEqual([driver.scheme]);

	const subscriber = await Subscriber.fromConnectionString<Message>(
		subscriberString as never,
	);
	const subscriberConnection = (
		subscriber as unknown as { connection?: EventConnection }
	).connection;
	cleanups.push(async () => {
		await (subscriber as { stop?: () => unknown }).stop?.();
		await subscriberConnection?.close();
	});

	const received: Message[] = [];
	await subscriber.subscribe(['order.placed'], async (message) => {
		received.push(message);
	});

	const publisher = await Publisher.fromConnectionString<Message>(
		connectionString as never,
	);
	const publisherConnection = (
		publisher as unknown as { connection?: EventConnection }
	).connection;
	cleanups.push(() => publisherConnection?.close());

	const id = unique();
	await publisher.publish([{ type: 'order.placed', payload: { id } }]);

	await vi.waitFor(
		() => expect(received).toEqual([{ type: 'order.placed', payload: { id } }]),
		{ timeout: 15_000, interval: 200 },
	);
}

describe('each events driver, registered alone', { timeout: 30_000 }, () => {
	it('basic:// delivers in-process', async () => {
		registerEventsDriver(basicEventsDriver);
		const connection = await basicEventsDriver.connect('basic://');
		const subscriber = basicEventsDriver.subscriberFor<Message>(connection, {});
		const received: Message[] = [];
		await subscriber.subscribe(['order.placed'], async (m) => {
			received.push(m);
		});

		await Publisher.fromConnection<Message>(connection).then((publisher) =>
			publisher.publish([{ type: 'order.placed', payload: { id: 'b1' } }]),
		);

		expect(received).toEqual([{ type: 'order.placed', payload: { id: 'b1' } }]);
	});

	it('pgboss:// delivers through Postgres', async () => {
		const schema = `pgboss_driver_${unique()}`;
		const database = `geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
		cleanups.push(() => dropSchemas(`postgres://${database}`, [schema]));
		const url = `pgboss://${database}?schema=${schema}`;

		await roundTrip(
			pgbossEventsDriver,
			url,
			`${url}&batchSize=5&pollingIntervalSeconds=1`,
		);
	});

	it('sqs:// delivers through a queue on the AWS emulator', async () => {
		const client = new SQSClient({
			region: REGION,
			endpoint: LOCALSTACK_URL,
			credentials: CREDENTIALS,
		});
		const { QueueUrl } = await client.send(
			new CreateQueueCommand({ QueueName: `driver-${unique()}` }),
		);
		cleanups.push(async () => {
			await client.send(new DeleteQueueCommand({ QueueUrl }));
			client.destroy();
		});

		await roundTrip(
			sqsEventsDriver,
			`${sqsUrl({ queueUrl: QueueUrl!, region: REGION, endpoint: LOCALSTACK_URL })}&accessKeyId=test&secretAccessKey=test`,
		);
	});

	it('sns:// delivers through a topic on the AWS emulator', async () => {
		const client = new SNSClient({
			region: REGION,
			endpoint: LOCALSTACK_URL,
			credentials: CREDENTIALS,
		});
		const { TopicArn } = await client.send(
			new CreateTopicCommand({ Name: `driver-${unique()}` }),
		);
		cleanups.push(async () => {
			await client.send(new DeleteTopicCommand({ TopicArn }));
			client.destroy();
		});
		const url = `sns://?topicArn=${encodeURIComponent(TopicArn!)}&region=${REGION}&endpoint=${encodeURIComponent(LOCALSTACK_URL)}&accessKeyId=test&secretAccessKey=test`;

		// SNS consumes through an SQS queue of its own, which its driver makes —
		// no SQS driver registered.
		await roundTrip(
			snsEventsDriver,
			url,
			`${url}&queueName=driver-${unique()}&deleteQueueOnClose=true&waitTimeSeconds=1`,
		);
	});

	it('rabbitmq:// delivers through an exchange', async () => {
		const url = `rabbitmq://${RABBITMQ_AUTHORITY}?exchange=driver-${unique()}&type=topic&timeout=3000`;

		await roundTrip(
			rabbitmqEventsDriver,
			url,
			`${url}&queueName=driver-${unique()}`,
		);
	});
});
