# @geekmidas/cli

A powerful CLI tool for building and managing TypeScript-based backend APIs with serverless deployment support. Generate AWS Lambda handlers, OpenAPI documentation, and server applications from your endpoint definitions.

## Features

- **Multi-Provider Support**: Generate handlers for AWS Lambda (API Gateway v1/v2) and server applications
- **Development Server**: Hot-reload development server with file watching
- **Telescope Integration**: Laravel-style debugging dashboard for inspecting requests, logs, and exceptions
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

  // Optional: Telescope debugging dashboard (enabled by default in dev)
  telescope: {
    enabled: true,
    path: '/__telescope',
  },
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
import { ConsoleLogger } from '@geekmidas/logger/console';

export const logger = new ConsoleLogger({
  level: process.env.LOG_LEVEL || 'info',
  pretty: process.env.NODE_ENV !== 'production',
});
```

### 4. Create Endpoints

Create endpoint files in `src/routes/`:

```typescript
// src/routes/users.ts
import { e } from '@geekmidas/constructs/endpoints';
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
import { SubscriberBuilder } from '@geekmidas/constructs/subscribers';
import type { Service } from '@geekmidas/services';
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
export const userCreatedSubscriber = new SubscriberBuilder()
  .publisher(userEventPublisher)
  .subscribe(['user.created'])
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

Generate OpenAPI TypeScript module from your endpoints. This is the recommended approach as it provides full type safety and a ready-to-use API client.

```bash
gkm openapi [options]
```

**Options:**
- `--output <path>`: Output file path (default: `openapi.ts`)
- `--json`: Generate legacy JSON format instead of TypeScript module

**Example:**
```bash
# Generate TypeScript module (recommended)
gkm openapi --output src/api.ts

# Generate legacy JSON format
gkm openapi --output docs/api.json --json
```

#### Generated TypeScript Module

The generated TypeScript module includes:

```typescript
// src/api.ts (auto-generated)

// Security schemes defined in your endpoints
export const securitySchemes = {
  jwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
} as const;

export type SecuritySchemeId = 'jwt' | 'apiKey';

// Endpoint-to-auth mapping
export const endpointAuth = {
  'GET /users': 'jwt',
  'POST /users': 'jwt',
  'GET /health': null,
} as const;

// TypeScript interfaces for request/response types
export interface GetUsersOutput {
  id: string;
  name: string;
}

// OpenAPI paths interface
export interface paths {
  '/users': {
    get: {
      responses: {
        200: { content: { 'application/json': GetUsersOutput[] } };
      };
    };
  };
}

// Ready-to-use API client factory
export function createApi(options: CreateApiOptions) {
  // ... implementation
}
```

#### Using the Generated Client

```typescript
import { createApi } from './api';

const api = createApi({
  baseURL: 'https://api.example.com',
  authStrategies: {
    jwt: {
      type: 'bearer',
      tokenProvider: async () => localStorage.getItem('token'),
    },
  },
});

// Imperative fetching
const users = await api('GET /users');

// React Query hooks
const { data } = api.useQuery('GET /users');
const mutation = api.useMutation('POST /users');
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
import { AmazonApiGatewayV1Endpoint } from '@geekmidas/constructs/aws';
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
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/aws';
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
import { HonoEndpoint } from '@geekmidas/constructs/endpoints';
import { ServiceDiscovery } from '@geekmidas/services';
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
├── server/
│   ├── app.ts               # Server application
│   ├── endpoints.ts         # Endpoint exports
├── manifest/
│   ├── aws.ts               # AWS manifest with types
│   └── server.ts            # Server manifest with types
└── openapi.json             # OpenAPI specification
```

### Build Manifest

The CLI generates TypeScript manifests with full type information in the `.gkm/manifest/` directory. These manifests export both the data and derived types for type-safe usage.

#### AWS Manifest (`.gkm/manifest/aws.ts`)

```typescript
export const manifest = {
  routes: [
    {
      path: '/users',
      method: 'GET',
      handler: '.gkm/aws-apigatewayv1/getUsers.handler',
      authorizer: 'jwt',
    },
    {
      path: '/users',
      method: 'POST',
      handler: '.gkm/aws-apigatewayv1/createUser.handler',
      authorizer: 'jwt',
    },
  ],
  functions: [
    {
      name: 'processData',
      handler: '.gkm/aws-lambda/functions/processData.handler',
      timeout: 60,
      memorySize: 256,
    },
  ],
  crons: [
    {
      name: 'dailyCleanup',
      handler: '.gkm/aws-lambda/crons/dailyCleanup.handler',
      schedule: 'rate(1 day)',
      timeout: 300,
      memorySize: 512,
    },
  ],
  subscribers: [],
} as const;

// Derived types
export type Route = (typeof manifest.routes)[number];
export type Function = (typeof manifest.functions)[number];
export type Cron = (typeof manifest.crons)[number];
export type Subscriber = (typeof manifest.subscribers)[number];

// Useful union types
export type Authorizer = Route['authorizer'];
export type HttpMethod = Route['method'];
export type RoutePath = Route['path'];
```

#### Server Manifest (`.gkm/manifest/server.ts`)

```typescript
export const manifest = {
  app: {
    handler: '.gkm/server/app.ts',
    endpoints: '.gkm/server/endpoints.ts',
  },
  routes: [
    { path: '/users', method: 'GET', authorizer: 'jwt' },
    { path: '/users', method: 'POST', authorizer: 'jwt' },
  ],
  subscribers: [
    { name: 'orderHandler', subscribedEvents: ['order.created'] },
  ],
} as const;

// Derived types
export type Route = (typeof manifest.routes)[number];
export type Subscriber = (typeof manifest.subscribers)[number];

// Useful union types
export type Authorizer = Route['authorizer'];
export type HttpMethod = Route['method'];
export type RoutePath = Route['path'];
```

#### Using Manifest Types

Import the manifest types for type-safe infrastructure configuration:

```typescript
import { manifest, type Route, type Authorizer } from './.gkm/manifest/aws';

// Type-safe route iteration
for (const route of manifest.routes) {
  console.log(`${route.method} ${route.path} -> ${route.handler}`);
}

// Use union types for validation
function isValidMethod(method: string): method is HttpMethod {
  return manifest.routes.some((r) => r.method === method);
}

// Access authorizer names
const authorizers = new Set(manifest.routes.map((r) => r.authorizer));
```

## OpenAPI Generation

The CLI generates a TypeScript module with full type safety and a ready-to-use API client:

```bash
gkm openapi --output src/api.ts
```

**Generated TypeScript Module:**

The generated module exports:

| Export | Description |
|--------|-------------|
| `securitySchemes` | OpenAPI security scheme definitions |
| `SecuritySchemeId` | Union type of security scheme names |
| `endpointAuth` | Map of endpoints to their auth requirements |
| `paths` | TypeScript interface for OpenAPI paths |
| `createApi()` | Factory function to create typed API client |

**Example Generated Output:**

```typescript
// Security schemes from your endpoint authorizers
export const securitySchemes = {
  jwt: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  },
} as const;

export type SecuritySchemeId = 'jwt';

// Which endpoints require which auth
export const endpointAuth = {
  'GET /users': 'jwt',
  'POST /users': 'jwt',
  'GET /health': null,  // Public endpoint
} as const;

// Type-safe paths interface
export interface paths {
  '/users': {
    get: {
      responses: {
        200: { content: { 'application/json': GetUsersOutput[] } };
      };
    };
    post: {
      requestBody: { content: { 'application/json': CreateUserInput } };
      responses: {
        201: { content: { 'application/json': GetUsersOutput } };
      };
    };
  };
}

// Factory to create API client
export interface CreateApiOptions {
  baseURL: string;
  authStrategies: Record<SecuritySchemeId, AuthStrategy>;
  queryClient?: QueryClient;
}

export function createApi(options: CreateApiOptions) {
  // Returns callable fetcher with React Query hooks
}
```

### Legacy JSON Output

For compatibility with other tools, you can still generate JSON:

```bash
gkm openapi --output api-docs.json --json
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

### Authentication Integration

Integrate `@geekmidas/auth` for JWT/OIDC authentication in your endpoints:

```typescript
// src/env.ts
import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    auth: {
      jwtSecret: get('JWT_SECRET').string(),
      jwtIssuer: get('JWT_ISSUER').string().optional(),
      jwtAudience: get('JWT_AUDIENCE').string().optional(),
    },
  }))
  .parse();
```

#### With Hono Middleware (Server Provider)

```typescript
// src/routes/protected.ts
import { e } from '@geekmidas/constructs/endpoints';
import { JwtMiddleware } from '@geekmidas/auth/hono/jwt';
import { envParser } from '../env.js';

const jwt = new JwtMiddleware({
  config: {
    secret: envParser.auth.jwtSecret,
    issuer: envParser.auth.jwtIssuer,
    audience: envParser.auth.jwtAudience,
  },
});

// Apply middleware to Hono app
app.use('/api/*', jwt.handler());
app.use('/public/*', jwt.optional());
```

#### With Lambda Authorizers (AWS Provider)

```typescript
// src/authorizers/jwt.ts
import { JwtAuthorizer } from '@geekmidas/auth/lambda/jwt';
import { envParser } from '../env.js';

const authorizer = new JwtAuthorizer({
  config: {
    secret: envParser.auth.jwtSecret,
    issuer: envParser.auth.jwtIssuer,
  },
  getContext: (claims) => ({
    userId: claims.sub!,
  }),
});

export const handler = authorizer.requestHandler();
```

#### With OIDC (Auth0, Cognito, etc.)

```typescript
// src/env.ts
export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    oidc: {
      issuer: get('OIDC_ISSUER').string().url(),
      audience: get('OIDC_AUDIENCE').string(),
    },
  }))
  .parse();

// src/authorizers/oidc.ts
import { OidcAuthorizer } from '@geekmidas/auth/lambda/oidc';
import { envParser } from '../env.js';

const authorizer = new OidcAuthorizer({
  config: {
    issuer: envParser.oidc.issuer,
    audience: envParser.oidc.audience,
  },
  getContext: (claims) => ({
    userId: claims.sub!,
    email: claims.email,
  }),
});

export const handler = authorizer.requestHandler();
```

### Custom Logger Configuration

Set up structured logging with different levels:

```typescript
// src/logger.ts
import { ConsoleLogger } from '@geekmidas/logger/console';

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