# @geekmidas/cloud

Cloud infrastructure utilities with SST integration for serverless deployments.

## Installation

```bash
pnpm add @geekmidas/cloud
```

## Overview

This package provides utilities for working with SST (Serverless Stack) resources in your application code. It bridges the gap between your infrastructure definitions and runtime code.

## Features

- SST resource name resolution from outputs
- Environment variable mapping for cloud resources
- Fallback support for local development
- Type-safe resource access

## Usage

### Getting SST Resources

```typescript
import { getResourceFromSst, getSstResourceName } from '@geekmidas/cloud/utils';

// Get an SST resource by name
const bucketName = getResourceFromSst('UploadBucket');

// Get resource with fallback for local development
const queueUrl = getSstResourceName('TaskQueue', process.env.LOCAL_QUEUE_URL);

// Common pattern for database connection
const databaseUrl = getResourceFromSst('DatabaseUrl') ?? process.env.DATABASE_URL;
```

### Integration with Services

```typescript
import { getResourceFromSst } from '@geekmidas/cloud/utils';
import type { Service } from '@geekmidas/services';
import { S3Client } from '@aws-sdk/client-s3';

const s3Service = {
  serviceName: 's3' as const,
  async register(envParser) {
    const bucket = getResourceFromSst('UploadBucket');

    if (!bucket) {
      throw new Error('UploadBucket SST resource not found');
    }

    return new S3Client({
      // AWS credentials from environment
    });
  }
} satisfies Service<'s3', S3Client>;
```

### With SST Configuration

In your SST configuration, resources are automatically exposed:

```typescript
// sst.config.ts
export default {
  stacks(app) {
    app.stack(({ stack }) => {
      const bucket = new Bucket(stack, 'UploadBucket');

      // Expose to application
      stack.addOutputs({
        UploadBucket: bucket.bucketName,
      });
    });
  }
};
```

## API Reference

### `getResourceFromSst(name: string): string | undefined`

Retrieves an SST resource value by name. Returns `undefined` if not found.

### `getSstResourceName(name: string, fallback?: string): string | undefined`

Retrieves an SST resource with an optional fallback value for local development.

## Environment Variables

SST automatically sets environment variables for resources. This package reads from:

- `SST_*` prefixed environment variables
- Standard AWS environment variables
- Custom resource outputs

## Local Development

For local development without SST, provide fallback values:

```typescript
const config = {
  bucket: getResourceFromSst('UploadBucket') ?? 'local-uploads',
  queue: getResourceFromSst('TaskQueue') ?? 'http://localhost:4566/queue',
  database: getResourceFromSst('DatabaseUrl') ?? process.env.DATABASE_URL,
};
```

## See Also

- [@geekmidas/envkit](/packages/envkit) - Environment configuration
- [@geekmidas/services](/packages/services) - Service discovery
- [SST Documentation](https://sst.dev)
