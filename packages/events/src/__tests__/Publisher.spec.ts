import { describe, expect, it } from 'vitest';
import { BasicConnection, BasicPublisher } from '../basic';
import { Publisher } from '../Publisher';
import { SNSPublisher } from '../sns/SNSPublisher';
import { SQSPublisher } from '../sqs/SQSPublisher';
import { SQSConnection } from '../sqs/SQSConnection';
import type { PublishableMessage } from '../types';

type TestMessage = PublishableMessage<'test.event', { data: string }>;

describe('Publisher', () => {
	describe('fromConnectionString', () => {
		it('should create Basic publisher from basic:// connection string', async () => {
			const connectionStr = 'basic://localhost';

			const publisher =
				await Publisher.fromConnectionString<TestMessage>(connectionStr);

			expect(publisher).toBeInstanceOf(BasicPublisher);
		});

		it('should create SQS publisher from sqs:// connection string', async () => {
			const connectionStr =
				'sqs://?queueUrl=https://sqs.us-east-1.amazonaws.com/123456789/test-queue&region=us-east-1&endpoint=http://localhost:4566';

			const publisher =
				await Publisher.fromConnectionString<TestMessage>(connectionStr);

			expect(publisher).toBeInstanceOf(SQSPublisher);
		});

		it('should create SNS publisher from sns:// connection string', async () => {
			const connectionStr =
				'sns://?topicArn=arn:aws:sns:us-east-1:123456789:test-topic&region=us-east-1&endpoint=http://localhost:4566&accessKeyId=test&secretAccessKey=test';

			const publisher =
				await Publisher.fromConnectionString<TestMessage>(connectionStr);

			expect(publisher).toBeInstanceOf(SNSPublisher);
		});

		it('should throw error for unsupported protocol', async () => {
			const connectionStr = 'unsupported://localhost';

			await expect(
				Publisher.fromConnectionString<TestMessage>(connectionStr),
			).rejects.toThrow('Unsupported event publisher type');
		});
	});

	describe('fromConnection', () => {
		it('should create Basic publisher from Basic connection', async () => {
			const connection = new BasicConnection();
			await connection.connect();

			const publisher =
				await Publisher.fromConnection<TestMessage>(connection);

			expect(publisher).toBeInstanceOf(BasicPublisher);

			await connection.close();
		});

		it('should create SQS publisher from SQS connection', async () => {
			const connection = await SQSConnection.fromConnectionString(
				'sqs://?queueUrl=https://sqs.us-east-1.amazonaws.com/123456789/test-queue&region=us-east-1&endpoint=http://localhost:4566',
			);

			const publisher =
				await Publisher.fromConnection<TestMessage>(connection);

			expect(publisher).toBeInstanceOf(SQSPublisher);
		});

		it('should throw error for unsupported connection type', async () => {
			const fakeConnection = {
				type: 'unsupported' as any,
			};

			await expect(
				Publisher.fromConnection<TestMessage>(fakeConnection as any),
			).rejects.toThrow('Unsupported connection type');
		});
	});
});
