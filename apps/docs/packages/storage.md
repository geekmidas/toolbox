# @geekmidas/storage

Cloud storage abstraction layer with provider-agnostic API.

## Installation

```bash
pnpm add @geekmidas/storage
```

## Features

- Unified interface for multiple storage providers
- AWS S3 implementation with presigned URLs
- File versioning support
- Presigned URL caching with `@geekmidas/cache`
- Type-safe file operations

## Package Exports

- `/` - Core storage interface
- `/aws` - AWS S3 implementation

## Basic Usage

### AWS S3 Storage

```typescript
import { AmazonStorageClient } from '@geekmidas/storage/aws';

const storage = AmazonStorageClient.create({
  bucket: process.env.S3_BUCKET!,
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
});
```

### Upload Files

```typescript
// Upload a buffer
await storage.upload('documents/report.pdf', fileBuffer, 'application/pdf');

// Upload with metadata
await storage.upload('images/photo.jpg', imageBuffer, 'image/jpeg', {
  metadata: {
    userId: '123',
    uploadedAt: new Date().toISOString(),
  },
});
```

### Download Files

```typescript
// Get file as buffer
const buffer = await storage.download('documents/report.pdf');

// Get presigned download URL
const url = await storage.getDownloadURL({
  path: 'documents/report.pdf',
  expiresIn: 3600, // 1 hour
});
```

### Presigned Upload URLs

Generate URLs for direct client uploads:

```typescript
// Get presigned upload URL
const uploadUrl = await storage.getUploadURL({
  path: 'uploads/user-upload.pdf',
  contentType: 'application/pdf',
  expiresIn: 300, // 5 minutes
});

// Client can upload directly to this URL
// await fetch(uploadUrl, { method: 'PUT', body: file });
```

### List and Delete Files

```typescript
// List files in a directory
const files = await storage.list('documents/');

// Delete a file
await storage.delete('documents/old-report.pdf');
```

## URL Caching

Presigned download URLs can be cached to avoid regenerating them on every request. Pass a cache instance when creating the storage client:

```typescript
import { AmazonStorageClient } from '@geekmidas/storage/aws';
import { InMemoryCache } from '@geekmidas/cache/memory';
// Or for production: import { UpstashCache } from '@geekmidas/cache/upstash';

const cache = new InMemoryCache<string>();

const storage = AmazonStorageClient.create({
  bucket: process.env.S3_BUCKET!,
  region: process.env.AWS_REGION!,
  cache, // Optional: cache presigned URLs
});

// First call generates and caches the URL
const url1 = await storage.getDownloadURL({ path: 'file.pdf' }, 3600);

// Subsequent calls return cached URL (until expiry)
const url2 = await storage.getDownloadURL({ path: 'file.pdf' }, 3600);
```

The cache TTL is automatically set to `expiresIn - 60` seconds to ensure URLs are refreshed before they expire.

## Storage Interface

```typescript
interface StorageClient {
  readonly provider: StorageProvider;
  readonly cache?: Cache;

  upload(key: string, data: string | Buffer, contentType: string): Promise<void>;
  getDownloadURL(file: File, expiresIn?: number): Promise<string>;
  getUploadURL(params: GetUploadParams, expiresIn?: number): Promise<string>;
  getUpload(params: GetUploadParams, expiresIn?: number): Promise<GetUploadResponse>;
  getVersions(key: string): Promise<DocumentVersion[]>;
  getVersionDownloadURL(file: File, versionId: string): Promise<string>;
}

interface File {
  name?: string;  // Optional filename for Content-Disposition
  path: string;   // S3 key
}

interface GetUploadParams {
  path: string;
  contentType: string;
  contentLength: number;
}
```

## Usage with Endpoints

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import type { Service } from '@geekmidas/services';
import { AmazonStorageClient } from '@geekmidas/storage/aws';

const storageService = {
  serviceName: 'storage' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      bucket: get('S3_BUCKET').string(),
      region: get('AWS_REGION').string(),
    })).parse();

    return AmazonStorageClient.create(config);
  }
} satisfies Service<'storage', AmazonStorageClient>;

const uploadEndpoint = e
  .post('/files/upload-url')
  .body(z.object({ filename: z.string(), contentType: z.string() }))
  .services([storageService])
  .handle(async ({ body, services }) => {
    const path = `uploads/${Date.now()}-${body.filename}`;
    const url = await services.storage.getUploadURL({
      path,
      contentType: body.contentType,
      expiresIn: 300,
    });

    return { uploadUrl: url, path };
  });
```
