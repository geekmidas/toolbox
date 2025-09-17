import { EnvironmentParser } from '@geekmidas/envkit';
import { z } from 'zod';
import { AmazonApiGatewayV1Endpoint } from '../src/adaptors/AmazonApiGatewayV1Endpoint';
import { AmazonApiGatewayV2Endpoint } from '../src/adaptors/AmazonApiGatewayV2Endpoint';
import { e } from '../src/constructs/EndpointFactory';
import type {
  EventPublisher,
  PublishableMessage,
} from '../src/constructs/events';
import type { Service } from '../src/services';

const logger = console;
// Define event types for the application
type UserEvent =
  | PublishableMessage<
      'user.created',
      { userId: string; email: string; source: string }
    >
  | PublishableMessage<'user.updated', { userId: string; changes: string[] }>
  | PublishableMessage<
      'notification.sent',
      { userId: string; type: string; channel: string }
    >;

// Simple event publisher implementation
class SimpleEventPublisher implements EventPublisher<UserEvent> {
  async publish(events: UserEvent[]): Promise<void> {
    for (const event of events) {
      logger.log(`Publishing event: ${event.type}`, event.payload);
      // In a real application, this would send to an event bus like EventBridge, SQS, etc.
    }
  }
}

const publisher: Service<'EventPublisherService', SimpleEventPublisher> = {
  serviceName: 'EventPublisherService',
  register: async () => new SimpleEventPublisher(),
};

// Create an endpoint with event publishing
const createUserEndpoint = e
  .publisher(publisher)
  .post('/users')
  .body(
    z.object({
      name: z.string(),
      email: z.string().email(),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      createdAt: z.string(),
    }),
  )
  .event({
    type: 'user.created',
    payload: (response) => ({
      userId: response.id,
      email: response.email,
      source: 'api',
    }),
  })
  .event({
    type: 'notification.sent',
    payload: (response) => ({
      userId: response.id,
      type: 'welcome',
      channel: 'email',
    }),
  })
  .handle(async ({ body }) => {
    // Simulate user creation
    const user = {
      id: Math.random().toString(36).substr(2, 9),
      name: body.name,
      email: body.email,
      createdAt: new Date().toISOString(),
    };

    logger.log('Created user:', user);
    return user;
  });

// Create another endpoint with conditional event publishing
const updateUserEndpoint = e
  .publisher(publisher)
  .put('/users/:id')
  .params(z.object({ id: z.string() }))
  .body(
    z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      emailChanged: z.boolean(),
    }),
  )
  .event({
    type: 'user.updated',
    payload: (response) => {
      const changes: string[] = [];
      if (response.emailChanged) changes.push('email');
      return {
        userId: response.id,
        changes,
      };
    },
    when: (response) => response.emailChanged, // Only publish if email was changed
  })
  .event({
    type: 'notification.sent',
    payload: (response) => ({
      userId: response.id,
      type: 'profile_updated',
      channel: 'email',
    }),
    when: (response) => response.emailChanged, // Only send notification if email changed
  })
  .handle(async ({ params, body }) => {
    // Simulate user update
    const emailChanged = !!body.email;

    const user = {
      id: params.id,
      name: body.name || 'John Doe',
      email: body.email || 'john@example.com',
      emailChanged,
    };

    logger.log('Updated user:', user);
    return user;
  });

// AWS API Gateway V1 Lambda handlers
const envParser = new EnvironmentParser({});

export const createUserV1Handler = new AmazonApiGatewayV1Endpoint(
  envParser,
  createUserEndpoint,
).handler;

export const updateUserV1Handler = new AmazonApiGatewayV1Endpoint(
  envParser,
  updateUserEndpoint,
).handler;

// AWS API Gateway V2 Lambda handlers
export const createUserV2Handler = new AmazonApiGatewayV2Endpoint(
  envParser,
  createUserEndpoint,
).handler;

export const updateUserV2Handler = new AmazonApiGatewayV2Endpoint(
  envParser,
  updateUserEndpoint,
).handler;

// Example usage:
/*
// For AWS Lambda with API Gateway V1
export { createUserV1Handler as handler };

// For AWS Lambda with API Gateway V2 (HTTP API)
export { createUserV2Handler as handler };

// The handlers will automatically:
// 1. Process the incoming request
// 2. Validate input against schemas
// 3. Execute the endpoint handler
// 4. Validate output against schemas
// 5. Publish events after successful completion
// 6. Return the appropriate response

// When a user is created via POST /users:
// - user.created event will be published with userId, email, and source
// - notification.sent event will be published for welcome message

// When a user is updated via PUT /users/:id with email change:
// - user.updated event will be published with changes array
// - notification.sent event will be published for profile update notification

// If user update doesn't include email change:
// - No events will be published due to the 'when' conditions
*/
