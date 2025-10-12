import { describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { RabbitMQPublisher } from '../RabbitMQPublisher';

type TestMessage = PublishableMessage<'user.created' | 'user.updated', any>;

const RABBITMQ_URL = 'amqp://geekmidas:geekmidas@localhost:5672';

// Helper to generate unique exchange names
const uniqueExchange = () =>
  `test-exchange-${Date.now()}-${Math.random().toString(36).substring(7)}`;

describe('RabbitMQPublisher - Integration Tests', () => {
  describe('constructor', () => {
    it('should create instance with default configuration', () => {
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: uniqueExchange(),
      });

      expect(publisher).toBeDefined();
    });

    it('should connect lazily on first publish', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      // Should not throw - connection happens on publish
      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });

    it('should work with custom exchange type', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
        exchangeType: 'direct',
      });

      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });

    it('should apply custom timeout', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
        timeout: 10000,
      });

      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });
  });

  describe('fromConnectionString', () => {
    it('should parse basic connection string with autoConnect=true', async () => {
      const testExchange = uniqueExchange();
      const publisher =
        await RabbitMQPublisher.fromConnectionString<TestMessage>(
          `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}&autoConnect=true`,
        );

      // Should already be connected
      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });

    it('should parse connection string with custom exchange', async () => {
      const testExchange = uniqueExchange();
      const publisher =
        await RabbitMQPublisher.fromConnectionString<TestMessage>(
          `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}&autoConnect=true`,
        );

      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });

    it('should parse connection string with type parameter', async () => {
      const testExchange = uniqueExchange();
      const publisher =
        await RabbitMQPublisher.fromConnectionString<TestMessage>(
          `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}&type=fanout&autoConnect=true`,
        );

      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });

    it('should parse connection string with timeout parameter', async () => {
      const testExchange = uniqueExchange();
      const publisher =
        await RabbitMQPublisher.fromConnectionString<TestMessage>(
          `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}&autoConnect=true&timeout=10000`,
        );

      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });

    it('should not auto-connect by default', async () => {
      const testExchange = uniqueExchange();
      const publisher =
        await RabbitMQPublisher.fromConnectionString<TestMessage>(
          `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}`,
        );

      // Should connect lazily on publish
      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });

    it('should respect autoConnect=false', async () => {
      const testExchange = uniqueExchange();
      const publisher =
        await RabbitMQPublisher.fromConnectionString<TestMessage>(
          `rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}&autoConnect=false`,
        );

      // Should connect lazily on publish
      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });
  });

  describe('publish', () => {
    it('should publish single message successfully', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      const messages: TestMessage[] = [
        {
          type: 'user.created',
          payload: { userId: '123', email: 'test@example.com' },
        },
      ];

      await publisher.publish(messages);
      await publisher.close();
    });

    it('should publish multiple messages with different routing keys', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      const messages: TestMessage[] = [
        { type: 'user.created', payload: { userId: '1' } },
        { type: 'user.updated', payload: { userId: '2' } },
        { type: 'user.created', payload: { userId: '3' } },
        { type: 'user.updated', payload: { userId: '4' } },
      ];

      await publisher.publish(messages);
      await publisher.close();
    });

    it('should serialize complex payloads to JSON', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      const complexPayload = {
        userId: '123',
        email: 'test@example.com',
        metadata: {
          createdAt: new Date().toISOString(),
          tags: ['new', 'active'],
          nested: {
            deep: {
              value: true,
            },
          },
        },
      };

      await publisher.publish([
        { type: 'user.created', payload: complexPayload },
      ]);

      await publisher.close();
    });

    it('should handle large batch of messages', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      // Create 100 messages
      const messages: TestMessage[] = Array.from({ length: 100 }, (_, i) => ({
        type: i % 2 === 0 ? 'user.created' : 'user.updated',
        payload: { userId: `user-${i}`, index: i },
      }));

      await publisher.publish(messages);
      await publisher.close();
    });

    it('should handle empty array', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      await publisher.publish([]);
      await publisher.close();
    });
  });

  describe('close', () => {
    it('should close connection gracefully', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
    });

    it('should allow reconnection after close', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      await publisher.publish([
        { type: 'user.created', payload: { userId: '1' } },
      ]);

      await publisher.close();

      // Should reconnect on next publish
      await publisher.publish([
        { type: 'user.created', payload: { userId: '2' } },
      ]);

      await publisher.close();
    });

    it('should not throw error if already closed', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      await publisher.publish([
        { type: 'user.created', payload: { userId: 'test' } },
      ]);

      await publisher.close();
      await expect(publisher.close()).resolves.toBeUndefined();
    });

    it('should handle close without ever connecting', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: RABBITMQ_URL,
        exchange: testExchange,
      });

      await expect(publisher.close()).resolves.toBeUndefined();
    });
  });

  describe('connection error handling', () => {
    it('should throw error for invalid hostname', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: 'amqp://geekmidas:geekmidas@invalid-host:5672',
        exchange: testExchange,
        timeout: 1000, // Short timeout for faster test
      });

      await expect(
        publisher.publish([
          { type: 'user.created', payload: { userId: '123' } },
        ]),
      ).rejects.toThrow();
    });

    it('should throw error for invalid credentials', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: 'amqp://wrong:wrong@localhost:5672',
        exchange: testExchange,
        timeout: 1000, // Short timeout for faster test
      });

      await expect(
        publisher.publish([
          { type: 'user.created', payload: { userId: '123' } },
        ]),
      ).rejects.toThrow();
    });

    it('should throw error for invalid port', async () => {
      const testExchange = uniqueExchange();
      const publisher = new RabbitMQPublisher<TestMessage>({
        url: 'amqp://geekmidas:geekmidas@localhost:9999',
        exchange: testExchange,
        timeout: 1000, // Short timeout for faster test
      });

      await expect(
        publisher.publish([
          { type: 'user.created', payload: { userId: '123' } },
        ]),
      ).rejects.toThrow();
    });
  });
});
