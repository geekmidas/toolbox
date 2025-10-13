# @geekmidas/cli

A powerful CLI tool for building and managing TypeScript-based backend APIs with serverless deployment support. Generate AWS Lambda handlers, OpenAPI documentation, and server applications from your endpoint definitions.

## Features

- **Multi-Provider Support**: Generate handlers for AWS Lambda (API Gateway v1/v2) and server applications
- **OpenAPI Generation**: Auto-generate OpenAPI 3.0 specifications from your endpoints
- **Type-Safe Configuration**: Configuration with TypeScript support and validation
- **Endpoint Auto-Discovery**: Automatically find and load endpoints from your codebase
- **Flexible Routing**: Support for glob patterns to discover route files
- **Environment Integration**: Seamless integration with @geekmidas/envkit for configuration
- **Logger Integration**: Built-in logging configuration and integration

## Installation

```bash
npm install @geekmidas/cli
```

### Global Installation

```bash
npm install -g @geekmidas/cli
```

## Quick Start

### 1. Create Configuration

Create a `gkm.config.ts` file in your project root:

```typescript
import type { GkmConfig } from '@geekmidas/cli';

const config: GkmConfig = {
  // Glob pattern to find endpoint files
  routes: 'src/routes/**/*.ts',

  // Optional: Functions
  functions: 'src/functions/**/*.ts',

  // Optional: Cron jobs
  crons: 'src/crons/**/*.ts',

  // Optional: Event subscribers
  subscribers: 'src/subscribers/**/*.ts',

  // Environment parser configuration
  envParser: './src/env.ts#envParser',

  // Logger configuration
  logger: './src/logger.ts#logger',
};

export default config;
```

### 2. Set Up Environment Parser

Create `src/env.ts`:

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    database: {
      url: get('DATABASE_URL').string().url(),
    },
    api: {
      port: get('PORT').string().transform(Number).default('3000'),
    },
    aws: {
      region: get('AWS_REGION').string().default('us-east-1'),
    },
  }))
  .parse();
```

### 3. Set Up Logger

Create `src/logger.ts`:

```typescript
import { ConsoleLogger } from '@geekmidas/api/logger';

export const logger = new ConsoleLogger({
  level: process.env.LOG_LEVEL || 'info',
  pretty: process.env.NODE_ENV !== 'production',
});
```

### 4. Create Endpoints

Create endpoint files in `src/routes/`:

```typescript
// src/routes/users.ts
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const getUsers = e
  .get('/users')
  .output(z.array(z.object({ id: z.string(), name: z.string() })))
  .handle(async () => {
    return [{ id: '1', name: 'John Doe' }];
  });

export const createUser = e
  .post('/users')
  .body(z.object({ name: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handle(async ({ body }) => {
    return { id: '2', name: body.name };
  });
```

### 5. Create Subscribers (Optional)

Create event subscribers in `src/subscribers/`:

```typescript
// src/subscribers/userSubscriber.ts
import { s } from '@geekmidas/api/subscriber';
import type { Service } from '@geekmidas/api/services';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import type { EnvironmentParser } from '@geekmidas/envkit';

// Define event types
type UserEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string }>;

// Create event publisher service
const userEventPublisher = {
  serviceName: 'userEventPublisher' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      publisherUrl: get('EVENT_PUBLISHER_URL').string()
    })).parse();

    const { Publisher } = await import('@geekmidas/events');
    return Publisher.fromConnectionString<UserEvents>(config.publisherUrl);
  }
} satisfies Service<'userEventPublisher', EventPublisher<UserEvents>>;

// Create subscriber
export const userCreatedSubscriber = s
  .publisher(userEventPublisher)
  .subscribe('user.created')
  .handle(async ({ events, logger }) => {
    for (const event of events) {
      logger.info({ userId: event.payload.userId }, 'Processing user.created event');
      // Process event...
    }
  });
```

### 6. Build Handlers

```bash
# Generate AWS Lambda handlers
npx gkm build --provider aws-apigatewayv1

# Generate server application
npx gkm build --provider server

# Generate OpenAPI specification
npx gkm openapi --output api-docs.json
```

## CLI Commands

### `gkm build`

Generate handlers from your endpoints.

```bash
gkm build [options]
```

**Options:**
- `--provider <provider>`: Target provider (default: `aws-apigatewayv1`)
  - `aws-apigatewayv1`: AWS API Gateway v1 Lambda handlers
  - `aws-apigatewayv2`: AWS API Gateway v2 Lambda handlers
  - `server`: Server application with Hono

**Example:**
```bash
# Generate AWS Lambda handlers
gkm build --provider aws-apigatewayv1

# Generate server application
gkm build --provider server
```

### `gkm openapi`

Generate OpenAPI 3.0 specification from your endpoints.

```bash
gkm openapi [options]
```

**Options:**
- `--output <path>`: Output file path (default: `openapi.json`)

**Example:**
```bash
# Generate OpenAPI spec
gkm openapi --output docs/api.json
```

### Future Commands

The following commands are planned for future releases:

- `gkm cron`: Manage cron jobs
- `gkm function`: Manage serverless functions
- `gkm api`: Manage REST API endpoints

## Configuration

### Configuration File

The `gkm.config.ts` file defines how the CLI discovers and processes your endpoints:

```typescript
interface GkmConfig {
  routes: string | string[];     // Glob patterns for endpoint files
  envParser: string;             // Path to environment parser
  logger: string;                // Path to logger configuration
}
```

### Configuration Options

#### `routes`

Glob pattern(s) to discover endpoint files. Can be a single pattern or array of patterns.

```typescript
// Single pattern
routes: 'src/routes/**/*.ts'

// Multiple patterns
routes: [
  'src/routes/**/*.ts',
  'src/api/**/*.ts',
  'src/handlers/**/*.ts'
]
```

#### `envParser`

Path to your environment parser configuration. Supports both default and named exports.

```typescript
// Default export
envParser: './src/env.ts'

// Named export
envParser: './src/env.ts#envParser'

// Renamed export
envParser: './src/config.ts#environmentConfig'
```

#### `logger`

Path to your logger configuration. Supports both default and named exports.

```typescript
// Default export
logger: './src/logger.ts'

// Named export
logger: './src/logger.ts#logger'

// Renamed export
logger: './src/utils.ts#appLogger'
```

## Providers

### AWS API Gateway v1

Generates Lambda handlers compatible with AWS API Gateway v1 (REST API).

```bash
gkm build --provider aws-apigatewayv1
```

**Generated Handler:**
```typescript
import { AmazonApiGatewayV1Endpoint } from '@geekmidas/api/aws-apigateway';
import { myEndpoint } from '../src/routes/example.js';
import { envParser } from '../src/env.js';

const adapter = new AmazonApiGatewayV1Endpoint(envParser, myEndpoint);

export const handler = adapter.handler;
```

### AWS API Gateway v2

Generates Lambda handlers compatible with AWS API Gateway v2 (HTTP API).

```bash
gkm build --provider aws-apigatewayv2
```

**Generated Handler:**
```typescript
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/api/aws-apigateway';
import { myEndpoint } from '../src/routes/example.js';
import { envParser } from '../src/env.js';

const adapter = new AmazonApiGatewayV2Endpoint(envParser, myEndpoint);

export const handler = adapter.handler;
```

### Server

Generates a server application using Hono that can be deployed to any Node.js environment.

```bash
gkm build --provider server
```

**Generated Server:**
```typescript
import { HonoEndpoint } from '@geekmidas/api/hono';
import { ServiceDiscovery } from '@geekmidas/api/services';
import { Hono } from 'hono';
import { envParser } from '../src/env.js';
import { logger } from '../src/logger.js';
import { getUsers, createUser } from '../src/routes/users.js';

export function createApp(app?: Hono): Hono {
  const honoApp = app || new Hono();

  const endpoints = [getUsers, createUser];

  const serviceDiscovery = ServiceDiscovery.getInstance(
    logger,
    envParser
  );

  HonoEndpoint.addRoutes(endpoints, serviceDiscovery, honoApp);

  return honoApp;
}

export default createApp;
```

## Output Structure

The CLI generates files in the `.gkm/<provider>` directory:

```
.gkm/
├── aws-apigatewayv1/
│   ├── getUsers.ts          # Individual Lambda handler
│   ├── createUser.ts        # Individual Lambda handler
│   └── manifest.json        # Build manifest
├── server/
│   ├── app.ts               # Server application
│   └── manifest.json        # Build manifest
└── openapi.json             # OpenAPI specification
```

### Build Manifest

Each provider generates a `manifest.json` file with build information:

```json
{
  "routes": [
    {
      "path": "/users",
      "method": "GET",
      "handler": ".gkm/aws-apigatewayv1/getUsers.handler"
    },
    {
      "path": "/users",
      "method": "POST",
      "handler": ".gkm/aws-apigatewayv1/createUser.handler"
    }
  ],
  "functions": [
    {
      "name": "processData",
      "handler": ".gkm/aws-lambda/functions/processData.handler",
      "timeout": 60,
      "memorySize": 256
    }
  ],
  "crons": [
    {
      "name": "dailyCleanup",
      "handler": ".gkm/aws-lambda/crons/dailyCleanup.handler",
      "schedule": "rate(1 day)",
      "timeout": 300,
      "memorySize": 512
    }
  ]
}
```

## OpenAPI Generation

The CLI automatically generates OpenAPI 3.0 specifications from your endpoints:

```bash
gkm openapi --output api-docs.json
```

**Generated OpenAPI:**
```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "API Documentation",
    "version": "1.0.0",
    "description": "Auto-generated API documentation from endpoints"
  },
  "paths": {
    "/users": {
      "get": {
        "summary": "Get Users",
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": { "type": "string" },
                      "name": { "type": "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Deployment Examples

### AWS Lambda with Serverless Framework

```yaml
# serverless.yml
service: my-api

provider:
  name: aws
  runtime: nodejs18.x

functions:
  getUsers:
    handler: .gkm/aws-apigatewayv1/getUsers.handler
    events:
      - http:
          path: users
          method: get
  
  createUser:
    handler: .gkm/aws-apigatewayv1/createUser.handler
    events:
      - http:
          path: users
          method: post
```

### Server Deployment

```typescript
// server.ts
import { createApp } from './.gkm/server/app.js';

const app = createApp();

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "server.js"]
```

## Advanced Usage

### Custom Environment Parser

Create complex environment configurations:

```typescript
// src/env.ts
import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    database: {
      url: get('DATABASE_URL').string().url(),
      ssl: get('DATABASE_SSL').string().transform(Boolean).default('false'),
      maxConnections: get('DB_MAX_CONNECTIONS')
        .string()
        .transform(Number)
        .default('10'),
    },
    
    redis: {
      url: get('REDIS_URL').string().url(),
      password: get('REDIS_PASSWORD').string().optional(),
    },
    
    aws: {
      region: get('AWS_REGION').string().default('us-east-1'),
      accessKeyId: get('AWS_ACCESS_KEY_ID').string().optional(),
      secretAccessKey: get('AWS_SECRET_ACCESS_KEY').string().optional(),
    },
    
    auth: {
      jwtSecret: get('JWT_SECRET').string(),
      jwtExpiry: get('JWT_EXPIRY').string().default('24h'),
    },
  }))
  .parse();
```

### Custom Logger Configuration

Set up structured logging with different levels:

```typescript
// src/logger.ts
import { ConsoleLogger } from '@geekmidas/api/logger';

export const logger = new ConsoleLogger({
  level: process.env.LOG_LEVEL || 'info',
  pretty: process.env.NODE_ENV !== 'production',
  context: {
    service: 'my-api',
    version: process.env.npm_package_version,
  },
});

// Add custom log methods
logger.addMethod('audit', (message: string, data?: any) => {
  logger.info(message, { type: 'audit', ...data });
});
```

### Multiple Route Patterns

Configure multiple patterns for complex project structures:

```typescript
// gkm.config.ts
const config: GkmConfig = {
  routes: [
    'src/routes/**/*.ts',
    'src/api/v1/**/*.ts',
    'src/api/v2/**/*.ts',
    'src/handlers/**/*.ts',
  ],
  envParser: './src/env.ts#envParser',
  logger: './src/logger.ts#logger',
};
```

## Error Handling

The CLI provides detailed error messages for common issues:

### Configuration Errors

```bash
# Missing config file
Error: gkm.config.ts not found. Please create a configuration file.

# Invalid config
Error: Failed to load gkm.config.ts: Invalid configuration
```

### Build Errors

```bash
# No endpoints found
No endpoints found to process

# Invalid provider
Error: Unsupported provider: invalid-provider
```

### OpenAPI Errors

```bash
# Generation failure
Error: OpenAPI generation failed: Invalid endpoint schema
```

## Integration with Development Workflow

### Package.json Scripts

```json
{
  "scripts": {
    "build": "gkm build",
    "build:lambda": "gkm build --provider aws-apigatewayv1",
    "build:server": "gkm build --provider server",
    "docs": "gkm openapi --output docs/api.json",
    "dev": "npm run build:server && node server.js"
  }
}
```

### CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy API

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Build handlers
        run: npm run build:lambda
        
      - name: Deploy to AWS
        run: npx serverless deploy
```

## Troubleshooting

### Common Issues

1. **Configuration not found**: Ensure `gkm.config.ts` is in your project root
2. **No endpoints found**: Check your glob patterns in the config
3. **Import errors**: Verify your environment parser and logger paths are correct
4. **TypeScript errors**: Ensure your endpoints are properly typed

### Working with Different Directories

When using the `--cwd` option to run the CLI from a different directory, TypeScript configuration (tsconfig.json) is resolved from the directory where the CLI is invoked, not from the target directory. This can cause issues with path resolution and type checking.

**Workarounds:**

1. **Run from the target directory** (recommended):
   ```bash
   cd /path/to/project && gkm build
   ```

2. **Use TS_NODE_PROJECT environment variable**:
   ```bash
   TS_NODE_PROJECT=/path/to/project/tsconfig.json gkm build --cwd /path/to/project
   ```

3. **Create a wrapper script**:
   ```bash
   #!/bin/bash
   # gkm-wrapper.sh
   cd "$1" && shift && gkm "$@"
   ```
   
   Then use:
   ```bash
   ./gkm-wrapper.sh /path/to/project build --provider server
   ```

4. **Use npx with explicit tsx configuration**:
   ```bash
   cd /path/to/project && npx tsx --tsconfig ./tsconfig.json node_modules/.bin/gkm build
   ```

### Debug Mode

Enable verbose logging by setting the environment variable:

```bash
DEBUG=gkm:* npx gkm build
```

## API Reference

### Types

```typescript
// Provider options
type Provider = 'server' | 'aws-apigatewayv1' | 'aws-apigatewayv2';

// Configuration interface
interface GkmConfig {
  routes: string | string[];
  envParser: string;
  logger: string;
}

// Build options
interface BuildOptions {
  provider: Provider;
}

// Route information
interface RouteInfo {
  path: string;
  method: string;
  handler: string;
}
```

## Contributing

1. Follow the existing code style (2 spaces, single quotes, semicolons)
2. Add tests for new features
3. Update documentation for API changes
4. Use semantic commit messages
5. Ensure all commands work across different providers

## License

MIT License - see the LICENSE file for details.