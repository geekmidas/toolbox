import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgBossNotStarted } from '../pgboss/errors';
import type { PgBossConnection } from '../pgboss/PgBossConnection';
import { PgBossPublisher } from '../pgboss/PgBossPublisher';
import { PgBossSubscriber } from '../pgboss/PgBossSubscriber';
import { RabbitMQChannelUnavailable } from '../rabbitmq/errors';
import type { RabbitMQConnection } from '../rabbitmq/RabbitMQConnection';
import { RabbitMQPublisher } from '../rabbitmq/RabbitMQPublisher';
import { RabbitMQSubscriber } from '../rabbitmq/RabbitMQSubscriber';
import { SNSConnection } from '../sns/SNSConnection';
import { SNSSubscriber, SnsQueueMissing } from '../sns/SNSSubscriber';
import { SQSConnection } from '../sqs/SQSConnection';
import { SQSPublisher, SqsBatchPartlyFailed } from '../sqs/SQSPublisher';

type Message = { type: 'user.created'; payload: { id: string } };
const message: Message = { type: 'user.created', payload: { id: '1' } };
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };

describe('SqsBatchPartlyFailed', () => {
	// SQS itself, answering a batch with one refused entry.
	const SQS = 'http://sqs.test';
	const server = setupServer(
		http.post(`${SQS}/`, () =>
			HttpResponse.json(
				{
					Successful: [],
					Failed: [
						{
							Id: '0',
							SenderFault: true,
							Code: 'InvalidMessageContents',
							Message: 'bad character',
						},
					],
				},
				{ headers: { 'content-type': 'application/x-amz-json-1.0' } },
			),
		),
	);
	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());

	it('names each message SQS refused', async () => {
		const connection = new SQSConnection({
			queueUrl: `${SQS}/000000000000/events`,
			region: 'us-east-1',
			endpoint: SQS,
			credentials,
		});
		const publisher = new SQSPublisher<Message>(connection);

		const failure = await publisher
			.publish([message])
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(SqsBatchPartlyFailed);
		expect((failure as SqsBatchPartlyFailed).failed).toEqual([
			{ id: '0', code: 'InvalidMessageContents', message: 'bad character' },
		]);
	});
});

describe('SnsQueueMissing', () => {
	it('refuses to subscribe through a queue it may not create', async () => {
		const subscriber = new SNSSubscriber<Message>(
			new SNSConnection({
				topicArn: 'arn:aws:sns:us-east-1:000000000000:events',
				region: 'us-east-1',
				endpoint: 'http://sns.test',
				credentials,
			}),
			{ queueName: 'events-sub', createQueue: false },
		);

		await expect(
			subscriber.subscribe(['user.created'], async () => {}),
		).rejects.toMatchObject({
			name: 'SnsQueueMissing',
			queueName: 'events-sub',
		});
		await expect(
			subscriber.subscribe(['user.created'], async () => {}),
		).rejects.toThrow(SnsQueueMissing);
	});
});

/**
 * A connection that reports itself connected but holds no client — what a
 * broker's client leaves when it opens without a channel or instance. The real
 * libraries cannot be made to do this on demand, so the state is built here.
 */
const connectedWithout = <T>(field: string) =>
	({ isConnected: () => true, [field]: undefined }) as unknown as T;

describe('RabbitMQChannelUnavailable', () => {
	const connection = connectedWithout<RabbitMQConnection>('amqpChannel');

	it('stops a publish with no channel to publish on', async () => {
		await expect(
			new RabbitMQPublisher<Message>(connection).publish([message]),
		).rejects.toThrow(RabbitMQChannelUnavailable);
	});

	it('stops a subscription with no channel to consume on', async () => {
		await expect(
			new RabbitMQSubscriber<Message>(connection).subscribe(
				['user.created'],
				async () => {},
			),
		).rejects.toThrow(RabbitMQChannelUnavailable);
	});
});

describe('PgBossNotStarted', () => {
	const connection = connectedWithout<PgBossConnection>('instance');

	it('stops a publish when pg-boss never started', async () => {
		await expect(
			new PgBossPublisher<Message>(connection).publish([message]),
		).rejects.toThrow(PgBossNotStarted);
	});

	it('stops a subscription when pg-boss never started', async () => {
		await expect(
			new PgBossSubscriber<Message>(connection).subscribe(
				['user.created'],
				async () => {},
			),
		).rejects.toThrow(PgBossNotStarted);
	});
});
