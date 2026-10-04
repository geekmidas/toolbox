# Function and Cron Support in @geekmidas/cli

## Overview

The @geekmidas/cli now supports building AWS Lambda functions and scheduled crons in addition to HTTP endpoints. This enables you to create a complete serverless application with:

- **HTTP Endpoints**: RESTful APIs via API Gateway
- **Functions**: Event-driven Lambda functions
- **Crons**: Scheduled Lambda functions with cron or rate expressions

## Configuration

### Simple Configuration

For basic usage, just specify the paths:

```json
{
  "routes": "./src/endpoints/**/*.ts",
  "functions": "./src/functions/**/*.ts",
  "crons": "./src/crons/**/*.ts",
  "envParser": "./src/env.ts#envParser",
  "logger": "./src/logger.ts#logger"
}
```

### Advanced Configuration

For fine-grained control over providers:

```json
{
  "routes": "./src/endpoints/**/*.ts",
  "functions": "./src/functions/**/*.ts",
  "crons": "./src/crons/**/*.ts",
  "envParser": "./src/env.ts#envParser",
  "logger": "./src/logger.ts#logger",
  "providers": {
    "aws": {
      "apiGateway": {
        "v1": false,
        "v2": true
      },
      "lambda": {
        "functions": true,
        "crons": true
      }
    },
    "server": {
      "enableOpenApi": true
    }
  }
}
```

## Writing Functions

Functions are standalone Lambda handlers that can be triggered by various AWS services:

```typescript
import { f } from '@geekmidas/constructs/functions';
import { z } from 'zod';

export const processOrder = f
  .input(
    z.object({
      orderId: z.string(),
      items: z.array(z.object({
        id: z.string(),
        quantity: z.number()
      }))
    })
  )
  .output(
    z.object({
      orderId: z.string(),
      status: z.enum(['processing', 'completed', 'failed'])
    })
  )
  .timeout(300000) // 5 minutes
  .handle(async ({ input, services, logger }) => {
    logger.info(`Processing order ${input.orderId}`);
    
    // Your business logic here
    
    return {
      orderId: input.orderId,
      status: 'completed'
    };
  });
```

## Writing Crons

Crons are scheduled functions that run on a regular basis:

```typescript
import { cron } from '@geekmidas/constructs/crons';

// Using cron expression (runs daily at 9 AM UTC)
export const dailyReport = cron
  .schedule('cron(0 9 * * ? *)')
  .timeout(600000) // 10 minutes
  .handle(async ({ services, logger }) => {
    logger.info('Generating daily report');
    
    // Your scheduled logic here
    
    return { success: true };
  });

// Using rate expression (runs every hour)
export const hourlyCleanup = cron
  .schedule('rate(1 hour)')
  .handle(async ({ services, logger }) => {
    logger.info('Running cleanup');
    
    // Your cleanup logic here
    
    return { itemsCleaned: 42 };
  });
```

### Schedule Expressions

- **Cron expressions**: `cron(Minutes Hours Day Month Weekday Year)`
  - Example: `cron(0 9 * * ? *)` - Daily at 9 AM UTC
  - Example: `cron(*/5 * * * ? *)` - Every 5 minutes
  
- **Rate expressions**: `rate(Value Unit)`
  - Example: `rate(5 minutes)`
  - Example: `rate(1 hour)`
  - Example: `rate(7 days)`

## Building

### New Simplified Commands

```bash
# Build for AWS (uses config to determine what to build)
gkm build --provider aws

# Build for local server development
gkm build --provider server

# Build everything configured in gkm.config.json
gkm build
```

## Generated Manifest

The root `gkm build` writes the application's manifest once, to
`.gkm/manifest/aws.ts` at the workspace root. Functions and crons are top-level
declarations in its `constructs` export, keyed by id:

```typescript
export const constructs = {
  ProcessOrder: {
    id: 'ProcessOrder',
    kind: 'function',
    handler: 'apps/api/.gkm/aws/functions/processOrder.handler',
    dependencies: [],
  },
  DailyReport: {
    id: 'DailyReport',
    kind: 'cron',
    handler: 'apps/api/.gkm/aws/crons/dailyReport.handler',
    schedule: 'cron(0 9 * * ? *)',
    dependencies: [],
  },
  // …every other construct
} as const satisfies ConstructManifest;
```

## Infrastructure Integration

`fromManifest` from `@geekmidas/cloud/sst` provisions every function (a Lambda
with an IAM-authorized URL) and every cron (a Lambda on its schedule), each
linked only to what it depends on:

```typescript
// sst.config.ts
const { App, fromManifest, Stack } = await import('@geekmidas/cloud/sst');
const { backends, constructs } = await import('./.gkm/manifest/aws.js');

fromManifest(new Stack(app, 'Shop'), constructs, {}, backends);
```

## Features

- **Type Safety**: Full TypeScript support with input/output validation
- **Service Injection**: Access configured services in your handlers
- **Structured Logging**: Built-in logger with request context
- **Error Handling**: Automatic error wrapping and reporting
- **Event Publishing**: Support for publishing events after execution
- **Timeout Control**: Configure function-specific timeouts

## Migration from Lambda Functions

If you have existing Lambda functions, you can gradually migrate them:

1. Create function wrappers using the `f` builder
2. Move business logic into the handle method
3. Add input/output schemas for validation
4. Configure services and logging as needed

## Best Practices

1. **Input Validation**: Always define input schemas for functions
2. **Error Handling**: Let the framework handle errors, throw meaningful exceptions
3. **Logging**: Use the provided logger for structured logs
4. **Timeouts**: Set appropriate timeouts based on expected execution time
5. **Testing**: Test functions locally before deployment