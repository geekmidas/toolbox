# Manifest Refactoring Design

## Current State

Currently, the CLI generates a single `manifest.json` file at `.gkm/manifest.json` that aggregates all routes, functions, crons, and subscribers across all providers.

```
.gkm/
├── manifest.json          # Single JSON manifest
├── aws-apigatewayv2/      # AWS handlers
│   ├── getUsers.ts
│   └── createUser.ts
└── server/                # Server handlers
    ├── app.ts
    └── endpoints.ts
```

### Problems

1. **Mixed provider data**: AWS and server routes are combined, causing `method: 'ALL'` to appear in manifests used for AWS infrastructure
2. **JSON format**: No TypeScript types available, consumers must define their own types
3. **No derived types**: Consumers can't easily extract types like `Authorizer` from the manifest

## Proposed Changes

### 1. Folder Structure

Change from single `manifest.json` to a `manifest/` folder with TypeScript files per provider:

```
.gkm/
├── manifest/
│   ├── aws.ts             # AWS-specific manifest
│   └── server.ts          # Server-specific manifest
├── aws-apigatewayv2/
│   ├── getUsers.ts
│   └── createUser.ts
└── server/
    ├── app.ts
    └── endpoints.ts
```

### 2. AWS Manifest (`manifest/aws.ts`)

Contains only AWS routes with actual HTTP methods (no `method: 'ALL'`):

```typescript
export const manifest = {
  routes: [
    {
      path: '/users',
      method: 'GET',
      handler: '.gkm/aws-apigatewayv2/getUsers.handler',
      timeout: 30,
      memorySize: 256,
      environment: ['DATABASE_URL', 'API_KEY'],
      authorizer: 'jwt',
    },
    {
      path: '/users',
      method: 'POST',
      handler: '.gkm/aws-apigatewayv2/createUser.handler',
      timeout: 30,
      memorySize: 256,
      environment: ['DATABASE_URL'],
      authorizer: 'jwt',
    },
  ],
  functions: [
    {
      name: 'processPayment',
      handler: '.gkm/aws-lambda/processPayment.handler',
      timeout: 60,
      memorySize: 512,
      environment: ['STRIPE_KEY'],
    },
  ],
  crons: [
    {
      name: 'dailyReport',
      handler: '.gkm/aws-lambda/dailyReport.handler',
      schedule: 'rate(1 day)',
      timeout: 300,
      memorySize: 256,
      environment: [],
    },
  ],
  subscribers: [
    {
      name: 'orderCreated',
      handler: '.gkm/aws-lambda/orderCreated.handler',
      subscribedEvents: ['order.created'],
      timeout: 30,
      memorySize: 256,
      environment: [],
    },
  ],
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

### 3. Server Manifest (`manifest/server.ts`)

Contains server app info and route metadata for documentation/type derivation:

```typescript
export const manifest = {
  app: {
    handler: '.gkm/server/app.ts',
    endpoints: '.gkm/server/endpoints.ts',
  },
  routes: [
    {
      path: '/users',
      method: 'GET',
      authorizer: 'jwt',
    },
    {
      path: '/users',
      method: 'POST',
      authorizer: 'jwt',
    },
  ],
  subscribers: [
    {
      name: 'orderCreated',
      subscribedEvents: ['order.created'],
    },
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

## Implementation Details

### Changes to `manifests.ts`

```typescript
export async function generateManifests(
  outputDir: string,
  provider: 'aws' | 'server',
  routes: RouteInfo[],
  functions: FunctionInfo[],
  crons: CronInfo[],
  subscribers: SubscriberInfo[],
): Promise<void> {
  const manifestDir = join(outputDir, 'manifest');
  await mkdir(manifestDir, { recursive: true });

  if (provider === 'aws') {
    await generateAwsManifest(manifestDir, routes, functions, crons, subscribers);
  } else {
    await generateServerManifest(manifestDir, routes, subscribers);
  }
}

async function generateAwsManifest(
  manifestDir: string,
  routes: RouteInfo[],
  functions: FunctionInfo[],
  crons: CronInfo[],
  subscribers: SubscriberInfo[],
): Promise<void> {
  // Filter out 'ALL' method routes (server-specific)
  const awsRoutes = routes.filter(r => r.method !== 'ALL');

  const content = `export const manifest = {
  routes: ${JSON.stringify(awsRoutes, null, 2)},
  functions: ${JSON.stringify(functions, null, 2)},
  crons: ${JSON.stringify(crons, null, 2)},
  subscribers: ${JSON.stringify(subscribers, null, 2)},
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
`;

  await writeFile(join(manifestDir, 'aws.ts'), content);
}
```

### Changes to Build Flow

Currently `buildCommand` aggregates all providers into one manifest. Change to:

1. Generate per-provider manifests during each provider's build
2. Remove aggregation step
3. Each provider generates its own TypeScript manifest file

```typescript
async function buildForProvider(
  provider: LegacyProvider,
  // ...
): Promise<BuildResult> {
  // ... existing build logic ...

  // Generate provider-specific manifest
  const manifestProvider = provider.startsWith('aws') ? 'aws' : 'server';
  await generateManifests(
    rootOutputDir,
    manifestProvider,
    routes,
    functionInfos,
    cronInfos,
    subscriberInfos,
  );

  return { routes, functions: functionInfos, crons: cronInfos, subscribers: subscriberInfos };
}
```

## Usage Examples

### AWS CDK / SST Integration

```typescript
import { manifest, type Route, type Authorizer } from './.gkm/manifest/aws';

// Type-safe iteration over routes
for (const route of manifest.routes) {
  new ApiGatewayRoute(this, route.path, {
    method: route.method,
    handler: route.handler,
    authorizer: getAuthorizer(route.authorizer),
  });
}

// Use derived types
function getAuthorizer(name: Authorizer): IAuthorizer {
  switch (name) {
    case 'jwt':
      return jwtAuthorizer;
    case 'apiKey':
      return apiKeyAuthorizer;
    case 'none':
      return undefined;
  }
}
```

### Type Checking Authorizer Values

```typescript
import type { Authorizer } from './.gkm/manifest/aws';

// Authorizer is a union type of all authorizer values
// e.g., 'jwt' | 'apiKey' | 'none'
const authorizer: Authorizer = 'jwt'; // ✓
const invalid: Authorizer = 'invalid'; // ✗ Type error
```

## Migration Notes

1. **Breaking change**: Consumers using `manifest.json` need to switch to TypeScript imports
2. **Benefit**: Full TypeScript support with derived types

## Design Decisions

1. **No backward compatibility**: `manifest.json` will not be generated
2. **Server manifest includes route metadata**: For documentation and type derivation
3. **No re-export index**: Each manifest is imported directly
