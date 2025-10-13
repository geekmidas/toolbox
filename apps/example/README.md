# Example Application

This is an example application that demonstrates how to use the `@geekmidas/toolbox` framework to build a server application with HTTP endpoints and event subscribers.

## Features

- ✅ HTTP endpoints with OpenAPI documentation
- ✅ Event subscribers for background processing
- ✅ Type-safe API with Zod validation
- ✅ Runtime-agnostic (Bun, Node.js, etc.)
- ✅ Local development with hot reload

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Build the Application

Generate the server files:

```bash
pnpm run build
```

This will create the `.gkm` directory with:
- `app.ts` - Main application setup
- `endpoints.ts` - HTTP endpoint registration
- `subscribers.ts` - Event subscriber setup

### 3. Start the Server

For local development with Bun:

```bash
pnpm run dev
```

The server will start on `http://localhost:3000` with:
- 🌐 HTTP endpoints at `/users`, `/health`, etc.
- 📚 OpenAPI documentation at `/docs`
- 📡 Event subscribers polling in the background

## Project Structure

```
apps/example/
├── src/
│   ├── config/
│   │   ├── env.ts         # Environment configuration
│   │   └── logger.ts      # Logger configuration
│   ├── endpoints/
│   │   ├── health.ts      # Health check endpoint
│   │   └── users.ts       # User CRUD endpoints
│   ├── subscribers/
│   │   └── userEvents.ts  # User event subscriber
│   └── index.ts           # Application entry point
├── .gkm/                  # Generated files (after build)
│   └── server/
│       ├── app.ts         # Generated app setup
│       ├── endpoints.ts   # Generated endpoint registration
│       └── subscribers.ts # Generated subscriber setup
├── gkm.config.ts          # Build configuration
└── package.json
```

## Available Endpoints

### GET /health
Health check endpoint
```bash
curl http://localhost:3000/health
```

### GET /users
Get all users
```bash
curl http://localhost:3000/users
```

### POST /users
Create a new user
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com"}'
```

### GET /users/:id
Get user by ID
```bash
curl http://localhost:3000/users/123
```

## Event Subscribers

The example includes a subscriber that listens for user events:
- `user.created`
- `user.updated`
- `user.deleted`

To use subscribers, set the `EVENT_SUBSCRIBER_CONNECTION_STRING` environment variable:

```bash
# For local development with LocalStack SQS
export EVENT_SUBSCRIBER_CONNECTION_STRING="sqs://us-east-1/000000000000/my-queue"

# For in-memory testing
export EVENT_SUBSCRIBER_CONNECTION_STRING="basic://in-memory"
```

## Configuration

### gkm.config.ts

```typescript
export default {
  routes: './src/endpoints/**/*.ts',
  subscribers: './src/subscribers/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
};
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EVENT_SUBSCRIBER_CONNECTION_STRING` | Connection string for event subscribers | - |

## Using Different Runtimes

### Bun (Default)

```typescript
import { createApp } from './.gkm/server/app.js';

const { app, start } = createApp();

await start({
  port: 3000,
  serve: (app, port) => {
    Bun.serve({ port, fetch: app.fetch });
  }
});
```

### Node.js

Install the Node.js adapter:
```bash
pnpm add @hono/node-server
```

Update `src/index.ts`:
```typescript
import { serve } from '@hono/node-server';
import { createApp } from './.gkm/server/app.js';

const { app, start } = createApp();

await start({
  port: 3000,
  serve: (app, port) => {
    serve({ fetch: app.fetch, port });
  }
});
```

### Deno

```typescript
import { createApp } from './.gkm/server/app.js';

const { app, start } = createApp();

await start({
  port: 3000,
  serve: (app, port) => {
    Deno.serve({ port }, app.fetch);
  }
});
```

## API Features

### Type-Safe Endpoints

All endpoints are fully type-safe with Zod validation:

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const createUser = e
  .post('/users')
  .body(z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  }))
  .handle(async ({ body, logger }) => {
    logger.info({ body }, 'Creating user');
    // Implementation
  });
```

### Event Subscribers

Subscribers process events from various sources:

```typescript
import { SubscriberBuilder } from '@geekmidas/api/subscriber';

export const userEventsSubscriber = new SubscriberBuilder()
  .subscribe(['user.created', 'user.updated'])
  .timeout(30000)
  .handle(async ({ events, logger }) => {
    for (const event of events) {
      logger.info({ event }, 'Processing event');
      // Handle event
    }
  });
```

## Development

### Watch Mode

The application supports hot reload when running with `bun run dev`.

### Rebuild

After making changes to endpoints or subscribers, rebuild:

```bash
pnpm run build
```

### OpenAPI Documentation

Visit `http://localhost:3000/docs` to see the generated OpenAPI documentation.

## Production Deployment

For production, use AWS Lambda instead of the polling mechanism:

1. Deploy endpoints as Lambda functions with API Gateway
2. Deploy subscribers as Lambda functions with SQS/SNS event sources
3. Use the generated handlers from `.gkm/aws-lambda/` or `.gkm/aws-apigatewayv2/`

See the main [toolbox documentation](../../README.md) for deployment guides.

## Learn More

- [API Documentation](../../packages/api/README.md)
- [Events Documentation](../../packages/events/README.md)
- [CLI Documentation](../../packages/cli/README.md)
