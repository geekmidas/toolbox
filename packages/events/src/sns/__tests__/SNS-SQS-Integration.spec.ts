import {
  CreateTopicCommand,
  DeleteTopicCommand,
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import { SQSConnection } from '../../sqs/SQSConnection';
import { SQSSubscriber } from '../../sqs/SQSSubscriber';
import type { PublishableMessage } from '../../types';
import { SNSConnection } from '../SNSConnection';
import { SNSPublisher } from '../SNSPublisher';

type TestMessage = PublishableMessage<'user.created' | 'user.updated', any>;

const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
const AWS_REGION = 'us-east-1';
const AWS_CREDENTIALS = {
  accessKeyId: 'test',
  secretAccessKey: 'test',
};

// Helper to create a unique topic name
const uniqueTopicName = () =>
  `test-topic-${Date.now()}-${Math.random().toString(36).substring(7)}`;

// Helper to create a unique queue name
const uniqueQueueName = () =>
  `test-queue-${Date.now()}-${Math.random().toString(36).substring(7)}`;

// Helper to create an SNS topic and return its ARN
async function createTopic(topicName: string): Promise<string> {
  const client = new SNSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: AWS_CREDENTIALS,
  });

  const command = new CreateTopicCommand({
    Name: topicName,
  });

  const response = await client.send(command);
  client.destroy();

  if (!response.TopicArn) {
    throw new Error('Failed to create topic');
  }

  return response.TopicArn;
}

// Helper to delete an SNS topic
async function deleteTopic(topicArn: string): Promise<void> {
  const client = new SNSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: AWS_CREDENTIALS,
  });

  const command = new DeleteTopicCommand({
    TopicArn: topicArn,
  });

  await client.send(command);
  client.destroy();
}

// Helper to create an SQS queue and return its URL
async function createQueue(queueName: string): Promise<string> {
  const client = new SQSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: AWS_CREDENTIALS,
  });

  const command = new CreateQueueCommand({
    QueueName: queueName,
  });

  const response = await client.send(command);
  client.destroy();

  if (!response.QueueUrl) {
    throw new Error('Failed to create queue');
  }

  return response.QueueUrl;
}

// Helper to get queue ARN
async function getQueueArn(queueUrl: string): Promise<string> {
  const client = new SQSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: AWS_CREDENTIALS,
  });

  const command = new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ['QueueArn'],
  });

  const response = await client.send(command);
  client.destroy();

  const queueArn = response.Attributes?.QueueArn;
  if (!queueArn) {
    throw new Error('Failed to get queue ARN');
  }

  return queueArn;
}

// Helper to set queue policy to allow SNS to send messages
async function setQueuePolicy(
  queueUrl: string,
  queueArn: string,
  topicArn: string,
): Promise<void> {
  const client = new SQSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: AWS_CREDENTIALS,
  });

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: 'SQS:SendMessage',
        Resource: queueArn,
        Condition: {
          ArnEquals: {
            'aws:SourceArn': topicArn,
          },
        },
      },
    ],
  };

  const command = new SetQueueAttributesCommand({
    QueueUrl: queueUrl,
    Attributes: {
      Policy: JSON.stringify(policy),
    },
  });

  await client.send(command);
  client.destroy();
}

// Helper to subscribe SQS queue to SNS topic
async function subscribeQueueToTopic(
  topicArn: string,
  queueArn: string,
): Promise<string> {
  const client = new SNSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: AWS_CREDENTIALS,
  });

  const command = new SubscribeCommand({
    TopicArn: topicArn,
    Protocol: 'sqs',
    Endpoint: queueArn,
  });

  const response = await client.send(command);
  client.destroy();

  if (!response.SubscriptionArn) {
    throw new Error('Failed to subscribe queue to topic');
  }

  return response.SubscriptionArn;
}

// Helper to unsubscribe
async function unsubscribe(subscriptionArn: string): Promise<void> {
  const client = new SNSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: AWS_CREDENTIALS,
  });

  const command = new UnsubscribeCommand({
    SubscriptionArn: subscriptionArn,
  });

  await client.send(command);
  client.destroy();
}

// Helper to delete a queue
async function deleteQueue(queueUrl: string): Promise<void> {
  const client = new SQSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: AWS_CREDENTIALS,
  });

  const command = new DeleteQueueCommand({
    QueueUrl: queueUrl,
  });

  await client.send(command);
  client.destroy();
}

describe('SNS to SQS Integration Tests', () => {
  it('should publish to SNS and receive via SQS subscription', async () => {
    const topicName = uniqueTopicName();
    const queueName = uniqueQueueName();

    const topicArn = await createTopic(topicName);
    const queueUrl = await createQueue(queueName);
    const queueArn = await getQueueArn(queueUrl);

    // Set queue policy to allow SNS
    await setQueuePolicy(queueUrl, queueArn, topicArn);

    // Subscribe queue to topic
    const subscriptionArn = await subscribeQueueToTopic(topicArn, queueArn);

    try {
      // Wait a moment for subscription to be ready
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create SNS publisher
      const snsConnection = new SNSConnection({
        topicArn,
        endpoint: LOCALSTACK_ENDPOINT,
        region: AWS_REGION,
        credentials: AWS_CREDENTIALS,
      });
      await snsConnection.connect();

      const snsPublisher = new SNSPublisher<TestMessage>(snsConnection);

      // Create SQS subscriber
      const sqsConnection = new SQSConnection({
        queueUrl,
        endpoint: LOCALSTACK_ENDPOINT,
        region: AWS_REGION,
        credentials: AWS_CREDENTIALS,
      });
      await sqsConnection.connect();

      const sqsSubscriber = new SQSSubscriber<TestMessage>(sqsConnection, {
        waitTimeSeconds: 1,
      });

      const receivedMessages: TestMessage[] = [];

      await sqsSubscriber.subscribe(['user.created'], async (message) => {
        receivedMessages.push(message);
      });

      // Publish via SNS
      await snsPublisher.publish([
        { type: 'user.created', payload: { userId: '123' } },
      ]);

      // Wait for message to be delivered (SNS to SQS is nearly instant)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      sqsSubscriber.stop();

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].type).toBe('user.created');
      expect(receivedMessages[0].payload.userId).toBe('123');

      await snsConnection.close();
      await sqsConnection.close();
    } finally {
      await unsubscribe(subscriptionArn);
      await deleteQueue(queueUrl);
      await deleteTopic(topicArn);
    }
  }, 15000);

  it('should fan out to multiple SQS queues', async () => {
    const topicName = uniqueTopicName();
    const queue1Name = uniqueQueueName();
    const queue2Name = uniqueQueueName();

    const topicArn = await createTopic(topicName);
    const queue1Url = await createQueue(queue1Name);
    const queue2Url = await createQueue(queue2Name);
    const queue1Arn = await getQueueArn(queue1Url);
    const queue2Arn = await getQueueArn(queue2Url);

    await setQueuePolicy(queue1Url, queue1Arn, topicArn);
    await setQueuePolicy(queue2Url, queue2Arn, topicArn);

    const subscription1Arn = await subscribeQueueToTopic(topicArn, queue1Arn);
    const subscription2Arn = await subscribeQueueToTopic(topicArn, queue2Arn);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create SNS publisher
      const snsConnection = new SNSConnection({
        topicArn,
        endpoint: LOCALSTACK_ENDPOINT,
        region: AWS_REGION,
        credentials: AWS_CREDENTIALS,
      });
      await snsConnection.connect();

      const snsPublisher = new SNSPublisher<TestMessage>(snsConnection);

      // Create SQS subscribers for both queues
      const sqsConnection1 = new SQSConnection({
        queueUrl: queue1Url,
        endpoint: LOCALSTACK_ENDPOINT,
        region: AWS_REGION,
        credentials: AWS_CREDENTIALS,
      });
      await sqsConnection1.connect();

      const sqsConnection2 = new SQSConnection({
        queueUrl: queue2Url,
        endpoint: LOCALSTACK_ENDPOINT,
        region: AWS_REGION,
        credentials: AWS_CREDENTIALS,
      });
      await sqsConnection2.connect();

      const sqsSubscriber1 = new SQSSubscriber<TestMessage>(sqsConnection1, {
        waitTimeSeconds: 1,
      });

      const sqsSubscriber2 = new SQSSubscriber<TestMessage>(sqsConnection2, {
        waitTimeSeconds: 1,
      });

      const queue1Messages: TestMessage[] = [];
      const queue2Messages: TestMessage[] = [];

      await sqsSubscriber1.subscribe(['user.created'], async (message) => {
        queue1Messages.push(message);
      });

      await sqsSubscriber2.subscribe(['user.created'], async (message) => {
        queue2Messages.push(message);
      });

      // Publish via SNS
      await snsPublisher.publish([
        { type: 'user.created', payload: { userId: '456' } },
      ]);

      // Wait for messages
      await new Promise((resolve) => setTimeout(resolve, 3000));

      sqsSubscriber1.stop();
      sqsSubscriber2.stop();

      // Both queues should receive the message
      expect(queue1Messages).toHaveLength(1);
      expect(queue2Messages).toHaveLength(1);
      expect(queue1Messages[0].payload.userId).toBe('456');
      expect(queue2Messages[0].payload.userId).toBe('456');

      await snsConnection.close();
      await sqsConnection1.close();
      await sqsConnection2.close();
    } finally {
      await unsubscribe(subscription1Arn);
      await unsubscribe(subscription2Arn);
      await deleteQueue(queue1Url);
      await deleteQueue(queue2Url);
      await deleteTopic(topicArn);
    }
  }, 20000);
});
