import { describe, expect, it } from 'vitest';
import { Subscriber } from '../Subscriber';
import { SNSSubscriber } from '../sns/SNSSubscriber';
import { SQSSubscriber } from '../sqs/SQSSubscriber';
import type { PublishableMessage } from '../types';

type TestMessage = PublishableMessage<'test.event', { data: string }>;

describe('Subscriber', () => {
	describe('fromConnectionString', () => {
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
	});
});
