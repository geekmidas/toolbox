import { describe, expect, it } from 'vitest';
import { BasicConnection, BasicSubscriber } from '../basic';
import { Subscriber } from '../Subscriber';
import { SNSSubscriber } from '../sns/SNSSubscriber';
import { SQSConnection } from '../sqs/SQSConnection';
import { SQSSubscriber } from '../sqs/SQSSubscriber';
import type { PublishableMessage } from '../types';

type TestMessage = PublishableMessage<'test.event', { data: string }>;

describe('Subscriber', () => {
	describe('fromConnectionString', () => {
		it('should create Basic subscriber from basic:// connection string', async () => {
			const connectionStr = 'basic://localhost';

			const subscriber =
				await Subscriber.fromConnectionString<TestMessage>(connectionStr);

			expect(subscriber).toBeInstanceOf(BasicSubscriber);
		});

		it('should create SQS subscriber without topicArn', async () => {
			const connectionStr =
				'sqs://?queueUrl=https://sqs.us-east-1.amazonaws.com/123456789/test-queue&region=us-east-1&endpoint=http://localhost:4566';

			const subscriber =
				await Subscriber.fromConnectionString<TestMessage>(connectionStr);

			expect(subscriber).toBeInstanceOf(SQSSubscriber);
		});

		it('should create SNS subscriber when topicArn is present in SQS connection string', async () => {
			const connectionStr =
				'sqs://?topicArn=arn:aws:sns:us-east-1:123456789:test-topic&queueName=test-queue&region=us-east-1&endpoint=http://localhost:4566&accessKeyId=test&secretAccessKey=test';

			const subscriber =
				await Subscriber.fromConnectionString<TestMessage>(connectionStr);

			expect(subscriber).toBeInstanceOf(SNSSubscriber);
		});

		it('should create SNS subscriber from sns:// connection string', async () => {
			const connectionStr =
				'sns://?topicArn=arn:aws:sns:us-east-1:123456789:test-topic&region=us-east-1&endpoint=http://localhost:4566&accessKeyId=test&secretAccessKey=test';

			const subscriber =
				await Subscriber.fromConnectionString<TestMessage>(connectionStr);

			expect(subscriber).toBeInstanceOf(SNSSubscriber);
		});

		it('should throw error for unsupported protocol', async () => {
			const connectionStr = 'unsupported://localhost';

			await expect(
				Subscriber.fromConnectionString<TestMessage>(connectionStr),
			).rejects.toThrow('Unsupported event subscriber type');
		});
	});

	describe('fromConnection', () => {
		it('should create Basic subscriber from Basic connection', async () => {
			const connection = new BasicConnection();
			await connection.connect();

			const subscriber =
				await Subscriber.fromConnection<TestMessage>(connection);

			expect(subscriber).toBeInstanceOf(BasicSubscriber);

			await connection.close();
		});

		it('should create SQS subscriber from SQS connection', async () => {
			const connection = await SQSConnection.fromConnectionString(
				'sqs://?queueUrl=https://sqs.us-east-1.amazonaws.com/123456789/test-queue&region=us-east-1&endpoint=http://localhost:4566',
			);

			const subscriber =
				await Subscriber.fromConnection<TestMessage>(connection);

			expect(subscriber).toBeInstanceOf(SQSSubscriber);
		});

		it('should throw error for unsupported connection type', async () => {
			const fakeConnection = {
				type: 'unsupported' as any,
			};

			await expect(
				Subscriber.fromConnection<TestMessage>(fakeConnection as any),
			).rejects.toThrow('Unsupported connection type');
		});
	});
});
