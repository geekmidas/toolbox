import { describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { SQSPublisher } from '../SQSPublisher';

type TestMessage = PublishableMessage<'user.created' | 'user.updated', any>;

const TEST_QUEUE_URL =
  'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue';

describe('SQSPublisher', () => {
  describe('constructor', () => {
    it('should create instance with queue URL', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
      });

      expect(publisher).toBeDefined();
    });

    it('should create instance with region', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
        region: 'us-east-1',
      });

      expect(publisher).toBeDefined();
    });

    it('should create instance with credentials', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      });

      expect(publisher).toBeDefined();
    });

    it('should create instance with custom batch size', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
        maxBatchSize: 5,
      });

      expect(publisher).toBeDefined();
    });

    it('should create instance with custom endpoint', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
        endpoint: 'http://localhost:4566',
      });

      expect(publisher).toBeDefined();
    });

    it('should default maxBatchSize to 10', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
      });

      // Access private config through any to test default
      expect((publisher as any).config.maxBatchSize).toBe(10);
    });
  });

  describe('fromConnectionString', () => {
    it('should parse basic connection string', async () => {
      const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
        `sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}`,
      );

      expect(publisher).toBeDefined();
    });

    it('should parse connection string with region', async () => {
      const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
        `sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&region=us-west-2`,
      );

      expect(publisher).toBeDefined();
      expect((publisher as any).config.region).toBe('us-west-2');
    });

    it('should parse connection string with credentials', async () => {
      const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
        `sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&accessKeyId=test-key&secretAccessKey=test-secret`,
      );

      expect(publisher).toBeDefined();
      expect((publisher as any).config.credentials).toEqual({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        sessionToken: undefined,
      });
    });

    it('should parse connection string with session token', async () => {
      const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
        `sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&accessKeyId=test-key&secretAccessKey=test-secret&sessionToken=test-token`,
      );

      expect(publisher).toBeDefined();
      expect((publisher as any).config.credentials).toEqual({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        sessionToken: 'test-token',
      });
    });

    it('should parse connection string with maxBatchSize', async () => {
      const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
        `sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&maxBatchSize=5`,
      );

      expect(publisher).toBeDefined();
      expect((publisher as any).config.maxBatchSize).toBe(5);
    });

    it('should parse connection string with endpoint', async () => {
      const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
        `sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&endpoint=${encodeURIComponent('http://localhost:4566')}`,
      );

      expect(publisher).toBeDefined();
      expect((publisher as any).config.endpoint).toBe('http://localhost:4566');
    });

    it('should parse connection string with all parameters', async () => {
      const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
        `sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&region=us-west-2&endpoint=${encodeURIComponent('http://localhost:4566')}&maxBatchSize=5&accessKeyId=test&secretAccessKey=secret`,
      );

      expect(publisher).toBeDefined();
      expect((publisher as any).config.region).toBe('us-west-2');
      expect((publisher as any).config.endpoint).toBe('http://localhost:4566');
      expect((publisher as any).config.maxBatchSize).toBe(5);
      expect((publisher as any).config.credentials).toEqual({
        accessKeyId: 'test',
        secretAccessKey: 'secret',
        sessionToken: undefined,
      });
    });

    it('should throw error if queueUrl is missing', async () => {
      await expect(
        SQSPublisher.fromConnectionString<TestMessage>('sqs://?region=us-east-1'),
      ).rejects.toThrow('queueUrl parameter is required');
    });
  });

  describe('batch creation', () => {
    it('should split messages into batches of 10', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
      });

      const messages: TestMessage[] = Array.from({ length: 25 }, (_, i) => ({
        type: 'user.created',
        payload: { userId: `user-${i}` },
      }));

      const batches = (publisher as any).createBatches(messages);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(10);
      expect(batches[1]).toHaveLength(10);
      expect(batches[2]).toHaveLength(5);
    });

    it('should respect custom batch size', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
        maxBatchSize: 5,
      });

      const messages: TestMessage[] = Array.from({ length: 12 }, (_, i) => ({
        type: 'user.created',
        payload: { userId: `user-${i}` },
      }));

      const batches = (publisher as any).createBatches(messages);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(5);
      expect(batches[1]).toHaveLength(5);
      expect(batches[2]).toHaveLength(2);
    });

    it('should handle empty message array', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
      });

      const batches = (publisher as any).createBatches([]);

      expect(batches).toHaveLength(0);
    });

    it('should handle single message', () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
      });

      const messages: TestMessage[] = [
        { type: 'user.created', payload: { userId: 'user-1' } },
      ];

      const batches = (publisher as any).createBatches(messages);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
    });
  });

  describe('close', () => {
    it('should close without error', async () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
      });

      await expect(publisher.close()).resolves.toBeUndefined();
    });

    it('should allow multiple close calls', async () => {
      const publisher = new SQSPublisher<TestMessage>({
        queueUrl: TEST_QUEUE_URL,
      });

      await publisher.close();
      await expect(publisher.close()).resolves.toBeUndefined();
    });
  });
});
