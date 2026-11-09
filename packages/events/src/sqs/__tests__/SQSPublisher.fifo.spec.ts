import { randomUUID } from 'node:crypto';
import {
	CreateQueueCommand,
	DeleteQueueCommand,
	ReceiveMessageCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { SQSPublisher } from '../SQSPublisher';

/** LocalStack, as the repo's docker-compose runs it. */
const ENDPOINT = 'http://localhost:4566';
const REGION = 'us-east-1';

const sqs = new SQSClient({
	region: REGION,
	endpoint: ENDPOINT,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

type ConversationMessage = PublishableMessage<
	'conversation',
	{ conversationId: string; text: string }
>;

describe('SQSPublisher on a FIFO queue', () => {
	it('sends each message in the group its groupId gives', async () => {
		const { QueueUrl } = await sqs.send(
			new CreateQueueCommand({
				QueueName: `publisher-${randomUUID()}.fifo`,
				Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' },
			}),
		);

		try {
			const publisher =
				await SQSPublisher.fromConnectionString<ConversationMessage>(
					`sqs://?queueUrl=${encodeURIComponent(QueueUrl as string)}&region=${REGION}&endpoint=${encodeURIComponent(ENDPOINT)}&accessKeyId=test&secretAccessKey=test`,
					{ groupId: (message) => message.payload.conversationId },
				);

			await publisher.publish([
				{ type: 'conversation', payload: { conversationId: 'a', text: '1' } },
				{ type: 'conversation', payload: { conversationId: 'b', text: '2' } },
			]);

			const { Messages = [] } = await sqs.send(
				new ReceiveMessageCommand({
					QueueUrl,
					MaxNumberOfMessages: 10,
					MessageSystemAttributeNames: ['MessageGroupId'],
					WaitTimeSeconds: 1,
				}),
			);

			const groups = Messages.map((m) => m.Attributes?.MessageGroupId).sort();
			expect(groups).toEqual(['a', 'b']);
		} finally {
			await sqs.send(new DeleteQueueCommand({ QueueUrl }));
		}
	});
});
