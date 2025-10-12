import { describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { BasicConnection } from '../BasicConnection';
import { BasicPublisher } from '../BasicPublisher';
import { BasicSubscriber } from '../BasicSubscriber';

type TestMessage = PublishableMessage<'user.created' | 'user.updated', any>;

describe('BasicSubscriber', () => {
  it('should receive published messages', async () => {
    const connection = new BasicConnection();
    await connection.connect();

    const publisher = new BasicPublisher<TestMessage>(connection);
    const subscriber = new BasicSubscriber<TestMessage>(connection);

    const receivedMessages: TestMessage[] = [];

    await subscriber.subscribe(['user.created'], async (message) => {
      receivedMessages.push(message);
    });

    await publisher.publish([
      { type: 'user.created', payload: { userId: '123' } },
    ]);

    // Give event emitter time to process
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toEqual({
      type: 'user.created',
      payload: { userId: '123' },
    });

    await connection.close();
  });

  it('should receive multiple message types', async () => {
    const connection = new BasicConnection();
    await connection.connect();

    const publisher = new BasicPublisher<TestMessage>(connection);
    const subscriber = new BasicSubscriber<TestMessage>(connection);

    const receivedMessages: TestMessage[] = [];

    await subscriber.subscribe(
      ['user.created', 'user.updated'],
      async (message) => {
        receivedMessages.push(message);
      },
    );

    await publisher.publish([
      { type: 'user.created', payload: { userId: '1' } },
      { type: 'user.updated', payload: { userId: '2' } },
      { type: 'user.created', payload: { userId: '3' } },
    ]);

    // Give event emitter time to process
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(receivedMessages).toHaveLength(3);
    expect(receivedMessages[0].type).toBe('user.created');
    expect(receivedMessages[1].type).toBe('user.updated');
    expect(receivedMessages[2].type).toBe('user.created');

    await connection.close();
  });

  it('should only receive subscribed message types', async () => {
    const connection = new BasicConnection();
    await connection.connect();

    const publisher = new BasicPublisher<TestMessage>(connection);
    const subscriber = new BasicSubscriber<TestMessage>(connection);

    const receivedMessages: TestMessage[] = [];

    // Only subscribe to user.created
    await subscriber.subscribe(['user.created'], async (message) => {
      receivedMessages.push(message);
    });

    await publisher.publish([
      { type: 'user.created', payload: { userId: '1' } },
      { type: 'user.updated', payload: { userId: '2' } },
      { type: 'user.created', payload: { userId: '3' } },
    ]);

    // Give event emitter time to process
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(receivedMessages).toHaveLength(2);
    expect(receivedMessages.every((m) => m.type === 'user.created')).toBe(true);

    await connection.close();
  });

  it('should handle multiple subscribers on same connection', async () => {
    const connection = new BasicConnection();
    await connection.connect();

    const publisher = new BasicPublisher<TestMessage>(connection);
    const subscriber1 = new BasicSubscriber<TestMessage>(connection);
    const subscriber2 = new BasicSubscriber<TestMessage>(connection);

    const messages1: TestMessage[] = [];
    const messages2: TestMessage[] = [];

    await subscriber1.subscribe(['user.created'], async (message) => {
      messages1.push(message);
    });

    await subscriber2.subscribe(['user.created'], async (message) => {
      messages2.push(message);
    });

    await publisher.publish([
      { type: 'user.created', payload: { userId: '123' } },
    ]);

    // Give event emitter time to process
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Both subscribers should receive the message
    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(1);

    await connection.close();
  });

  it('should handle async listener errors gracefully', async () => {
    const connection = new BasicConnection();
    await connection.connect();

    const publisher = new BasicPublisher<TestMessage>(connection);
    const subscriber = new BasicSubscriber<TestMessage>(connection);

    const receivedMessages: TestMessage[] = [];

    await subscriber.subscribe(['user.created'], async (message) => {
      if (message.payload.userId === '2') {
        throw new Error('Test error');
      }
      receivedMessages.push(message);
    });

    await publisher.publish([
      { type: 'user.created', payload: { userId: '1' } },
      { type: 'user.created', payload: { userId: '2' } },
      { type: 'user.created', payload: { userId: '3' } },
    ]);

    // Give event emitter time to process
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should receive messages 1 and 3 (2 throws error)
    expect(receivedMessages).toHaveLength(2);
    expect(receivedMessages[0].payload.userId).toBe('1');
    expect(receivedMessages[1].payload.userId).toBe('3');

    await connection.close();
  });
});
