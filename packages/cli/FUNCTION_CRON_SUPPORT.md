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
import { f } from '@geekmidas/api/function';
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
import { cron } from '@geekmidas/api/cron';

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

### Legacy Commands (Deprecated)

```bash
# Still supported but deprecated
gkm build --providers aws-lambda,aws-apigatewayv2
```

This generates:

```
.gkm/
└── aws-lambda/
    ├── routes/
    │   └── [endpoint handlers]
    ├── functions/
    │   └── [function handlers]
    ├── crons/
    │   └── [cron handlers]
    ├── routes.json
    ├── functions.json
    └── crons.json
```

## Generated Manifests

### functions.json
```json
{
  "functions": [
    {
      "name": "processOrder",
      "handler": ".gkm/aws-lambda/functions/processOrder.handler",
      "timeout": 300000
    }
  ]
}
```

### crons.json
```json
{
  "crons": [
    {
      "name": "dailyReport",
      "handler": ".gkm/aws-lambda/crons/dailyReport.handler",
      "schedule": "cron(0 9 * * ? *)",
      "timeout": 600000
    }
  ]
}
```

## Infrastructure Integration

The generated manifests can be consumed by infrastructure tools like AWS CDK or Terraform to deploy your functions:

```typescript
// AWS CDK Example
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import functionsManifest from './.gkm/aws-lambda/functions.json';
import cronsManifest from './.gkm/aws-lambda/crons.json';

// Deploy functions
for (const fn of functionsManifest.functions) {
  new Function(stack, fn.name, {
    runtime: Runtime.NODEJS_20_X,
    handler: fn.handler,
    code: Code.fromAsset('.'),
    timeout: Duration.millis(fn.timeout || 30000)
  });
}

// Deploy crons
for (const cron of cronsManifest.crons) {
  const fn = new Function(stack, cron.name, {
    runtime: Runtime.NODEJS_20_X,
    handler: cron.handler,
    code: Code.fromAsset('.'),
    timeout: Duration.millis(cron.timeout || 30000)
  });
  
  new Rule(stack, `${cron.name}Rule`, {
    schedule: Schedule.expression(cron.schedule),
    targets: [new LambdaFunction(fn)]
  });
}
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