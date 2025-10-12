# @geekmidas/events

A unified event messaging library with support for multiple backends (Basic, RabbitMQ, SQS, SNS). Write your event-driven code once and switch between messaging systems without changing your application logic.

## Features

- ✅ **Unified Interface**: Single API for publishing and subscribing to events across different messaging systems
- ✅ **Type-Safe**: Full TypeScript support with type inference for message types and payloads
- ✅ **Multiple Backends**: Basic (in-memory), RabbitMQ, AWS SQS, AWS SNS
- ✅ **Connection Strings**: Configure messaging systems using simple connection strings
- ✅ **Factory Pattern**: Create publishers and subscribers from connections or connection strings
- ✅ **SNS→SQS Integration**: Managed push-based messaging with automatic queue setup
- ✅ **Flexible**: Direct SQS access or managed SNS subscription patterns

## Installation

```bash
pnpm add @geekmidas/events
```

### Peer Dependencies

Depending on which messaging backend you use, install the appropriate SDK:

```bash
# For RabbitMQ
pnpm add amqplib

# For AWS SQS/SNS
pnpm add @aws-sdk/client-sqs @aws-sdk/client-sns
```

## Quick Start

### 1. Define Your Message Types

```typescript
import type { PublishableMessage } from '@geekmidas/events';

type UserEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: Record<string, any> }>
  | PublishableMessage<'user.deleted', { userId: string }>;
```

### 2. Create Publisher and Subscriber

```typescript
import { Publisher, Subscriber } from '@geekmidas/events';

// Create publisher from connection string
const publisher = await Publisher.fromConnectionString<UserEvents>(
  'rabbitmq://localhost:5672?exchange=events'
);

// Create subscriber from connection string
const subscriber = await Subscriber.fromConnectionString<UserEvents>(
  'rabbitmq://localhost:5672?exchange=events&queue=user-service'
);

// Subscribe to events
await subscriber.subscribe(['user.created', 'user.updated'], async (message) => {
  console.log('Received:', message.type, message.payload);
});

// Publish events
await publisher.publish([
  {
    type: 'user.created',
    payload: { userId: '123', email: 'user@example.com' }
  }
]);
```

## Messaging Backends

### Basic (In-Memory)

Perfect for testing and development. Uses Node.js EventEmitter.

```typescript
import { BasicConnection, BasicPublisher, BasicSubscriber } from '@geekmidas/events/basic';

const connection = new BasicConnection();
await connection.connect();

const publisher = new BasicPublisher(connection);
const subscriber = new BasicSubscriber(connection);

await subscriber.subscribe(['user.created'], async (message) => {
  console.log('User created:', message.payload);
});

await publisher.publish([
  { type: 'user.created', payload: { userId: '123' } }
]);
```

**Connection String Format:**
```
basic://
```

### RabbitMQ

Production-ready message broker with advanced features.

```typescript
import { RabbitMQConnection, RabbitMQPublisher, RabbitMQSubscriber } from '@geekmidas/events/rabbitmq';

const connection = new RabbitMQConnection({
  url: 'amqp://localhost:5672',
  exchange: 'events',
  exchangeType: 'topic',
});
await connection.connect();

const publisher = new RabbitMQPublisher(connection);
const subscriber = new RabbitMQSubscriber(connection, {
  queueName: 'user-service',
  prefetch: 10,
});

await subscriber.subscribe(['user.created', 'user.updated'], async (message) => {
  console.log('Processing:', message.type, message.payload);
});

await publisher.publish([
  { type: 'user.created', payload: { userId: '123' } }
]);
```

**Connection String Format:**
```
rabbitmq://localhost:5672?exchange=events&exchangeType=topic&queue=myqueue
```

**Options:**
- `exchange` - Exchange name (required)
- `exchangeType` - Exchange type: `topic`, `fanout`, `direct` (default: `topic`)
- `queue` - Queue name (optional, auto-generated if not provided)
- `prefetch` - Prefetch limit (default: 10)

### AWS SQS

Direct SQS queue access for pull-based messaging.

```typescript
import { SQSConnection, SQSPublisher, SQSSubscriber } from '@geekmidas/events/sqs';

const connection = new SQSConnection({
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue',
  region: 'us-east-1',
});
await connection.connect();

const publisher = new SQSPublisher(connection);
const subscriber = new SQSSubscriber(connection, {
  waitTimeSeconds: 20, // Long polling
  maxMessages: 10,
});

await subscriber.subscribe(['user.created'], async (message) => {
  console.log('Received from SQS:', message.payload);
});

await publisher.publish([
  { type: 'user.created', payload: { userId: '123' } }
]);
```

**Connection String Format:**
```
sqs://?queueUrl=https://sqs.us-east-1.amazonaws.com/123456789/my-queue&region=us-east-1
```

**Options:**
- `queueUrl` - SQS queue URL (required)
- `region` - AWS region (required)
- `endpoint` - Custom endpoint for LocalStack (optional)
- `accessKeyId`, `secretAccessKey` - AWS credentials (optional)
- `waitTimeSeconds` - Long polling duration (default: 20)
- `maxMessages` - Max messages per poll (default: 10)

### AWS SNS

Push-based pub/sub messaging with automatic SQS queue management.

```typescript
import { SNSConnection, SNSPublisher, SNSSubscriber } from '@geekmidas/events/sns';

const connection = new SNSConnection({
  topicArn: 'arn:aws:sns:us-east-1:123456789:events',
  region: 'us-east-1',
});
await connection.connect();

const publisher = new SNSPublisher(connection);

// SNS Subscriber automatically creates and manages an SQS queue
const subscriber = new SNSSubscriber(connection, {
  queueName: 'my-service-queue', // Optional
  createQueue: true,
  deleteQueueOnClose: false,
});

await subscriber.subscribe(['user.created'], async (message) => {
  console.log('Received via SNS:', message.payload);
});

await publisher.publish([
  { type: 'user.created', payload: { userId: '123' } }
]);

// Cleanup
await subscriber.stop(); // Unsubscribes and optionally deletes queue
```

**Connection String Format:**
```
sns://?topicArn=arn:aws:sns:us-east-1:123456789:events&region=us-east-1&queueName=my-queue
```

**Options:**
- `topicArn` - SNS topic ARN (required)
- `region` - AWS region (required)
- `endpoint` - Custom endpoint for LocalStack (optional)
- `queueName` - SQS queue name (optional, auto-generated if not provided)
- `createQueue` - Auto-create queue (default: true)
- `deleteQueueOnClose` - Delete queue on stop (default: true for auto-generated queues)

## Advanced Usage

### Managed SNS→SQS Subscription via SQS Connection String

You can use a SQS connection string with a `topicArn` parameter to automatically get managed SNS subscription:

```typescript
import { Subscriber } from '@geekmidas/events';

// This automatically creates an SNS subscriber with managed queue
const subscriber = await Subscriber.fromConnectionString(
  'sqs://?topicArn=arn:aws:sns:us-east-1:123456789:events&queueName=my-queue&region=us-east-1'
);
```

When `topicArn` is present in an SQS connection string, it automatically:
1. Creates an SNS connection
2. Sets up managed SQS queue
3. Subscribes queue to SNS topic
4. Filters messages by topic ARN and message type

### Manual SNS→SQS Integration

For more control, manually subscribe an SQS queue to an SNS topic:

```typescript
import { SNSPublisher, SNSConnection } from '@geekmidas/events/sns';
import { SQSSubscriber, SQSConnection } from '@geekmidas/events/sqs';

// Publisher sends to SNS
const snsConnection = new SNSConnection({
  topicArn: 'arn:aws:sns:us-east-1:123456789:events',
  region: 'us-east-1',
});
const publisher = new SNSPublisher(snsConnection);

// Subscriber receives from SQS (queue must be subscribed to SNS topic)
const sqsConnection = new SQSConnection({
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue',
  region: 'us-east-1',
});
const subscriber = new SQSSubscriber(sqsConnection, {
  expectedTopicArn: 'arn:aws:sns:us-east-1:123456789:events', // Verify messages
});

await subscriber.subscribe(['user.created'], async (message) => {
  // Automatically parses SNS wrapper
  console.log('Received:', message.payload);
});
```

### Sharing Connections

You can share connections between publishers and subscribers:

```typescript
import { EventConnectionFactory, Publisher, Subscriber } from '@geekmidas/events';

const connection = await EventConnectionFactory.create(
  'rabbitmq://localhost:5672?exchange=events'
);

const publisher = await Publisher.fromConnection(connection);
const subscriber = await Subscriber.fromConnection(connection);
```

### Message Filtering

Subscribers only receive messages they're subscribed to:

```typescript
// Only receives user.created and user.updated
await subscriber.subscribe(['user.created', 'user.updated'], async (message) => {
  if (message.type === 'user.created') {
    console.log('New user:', message.payload.userId);
  } else {
    console.log('User updated:', message.payload.userId);
  }
});
```

### Error Handling

```typescript
await subscriber.subscribe(['user.created'], async (message) => {
  try {
    await processUser(message.payload);
  } catch (error) {
    console.error('Failed to process user:', error);
    // For RabbitMQ: message will be nack'd and requeued
    // For SQS: message visibility timeout will expire and retry
    throw error;
  }
});
```

## Architecture Patterns

### Fan-Out (SNS → Multiple SQS Queues)

```
                    ┌─────────────┐
                    │ SNS Topic   │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
       ┌────▼────┐    ┌───▼─────┐   ┌───▼─────┐
       │ Queue 1 │    │ Queue 2 │   │ Queue 3 │
       └────┬────┘    └────┬────┘   └────┬────┘
            │              │              │
       ┌────▼────┐    ┌───▼─────┐   ┌───▼─────┐
       │Service 1│    │Service 2│   │Service 3│
       └─────────┘    └─────────┘   └─────────┘
```

### Direct Queue (SQS)

```
┌───────────┐      ┌────────────┐      ┌──────────┐
│ Publisher │─────▶│  SQS Queue │─────▶│Subscriber│
└───────────┘      └────────────┘      └──────────┘
```

### Managed Subscription (SNS Subscriber)

```
┌───────────┐      ┌───────────┐      ┌─────────────┐      ┌──────────┐
│ Publisher │─────▶│ SNS Topic │─────▶│ SQS Queue   │─────▶│Subscriber│
└───────────┘      └───────────┘      │(auto-managed)│      └──────────┘
                                       └─────────────┘
```

## Testing

Use the Basic implementation for testing:

```typescript
import { BasicConnection, BasicPublisher, BasicSubscriber } from '@geekmidas/events/basic';
import { describe, it, expect } from 'vitest';

describe('Event processing', () => {
  it('should process user events', async () => {
    const connection = new BasicConnection();
    const publisher = new BasicPublisher(connection);
    const subscriber = new BasicSubscriber(connection);

    const received = [];
    await subscriber.subscribe(['user.created'], async (message) => {
      received.push(message);
    });

    await publisher.publish([
      { type: 'user.created', payload: { userId: '123' } }
    ]);

    expect(received).toHaveLength(1);
    expect(received[0].payload.userId).toBe('123');
  });
});
```

## LocalStack Setup

For local development with SQS/SNS, use LocalStack:

```yaml
# docker-compose.yml
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=sqs,sns
      - DEBUG=1
```

Then use `endpoint: 'http://localhost:4566'` in your configuration.

## API Reference

### Publisher

```typescript
class Publisher {
  static fromConnectionString<T>(connectionStr: string): Promise<EventPublisher<T>>
  static fromConnection<T>(connection: EventConnection): Promise<EventPublisher<T>>
}
```

### Subscriber

```typescript
class Subscriber {
  static fromConnectionString<T>(connectionStr: string): Promise<EventSubscriber<T>>
  static fromConnection<T>(connection: EventConnection): Promise<EventSubscriber<T>>
}
```

### EventPublisher

```typescript
interface EventPublisher<TMessage> {
  publish(messages: TMessage[]): Promise<void>
}
```

### EventSubscriber

```typescript
interface EventSubscriber<TMessage> {
  subscribe(
    messages: TMessage['type'][],
    listener: (payload: TMessage) => Promise<void>
  ): Promise<void>
  stop(): void | Promise<void>
}
```

### PublishableMessage

```typescript
type PublishableMessage<TType extends string, TPayload> = {
  type: TType
  payload: TPayload
}
```

## Best Practices

1. **Define Message Types**: Use TypeScript union types for all your message types
2. **Message Type Naming**: Use dot notation for namespacing (e.g., `user.created`, `order.shipped`)
3. **Error Handling**: Always handle errors in your message listeners
4. **Connection Pooling**: Reuse connections when possible
5. **Testing**: Use Basic implementation for unit tests, real backends for integration tests
6. **Cleanup**: Always call `stop()` on subscribers when shutting down
7. **Message Versioning**: Include version in message type for breaking changes (e.g., `user.created.v2`)

## License

MIT
