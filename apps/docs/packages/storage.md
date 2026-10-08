# @geekmidas/storage

Cloud storage abstraction layer with provider-agnostic API.

::: tip Declare the bucket
A `StorageClient` is what a declared `ObjectStorage` hands back — you rarely
construct one by hand:

```typescript
import { ObjectStorage } from '@geekmidas/constructs/object-storage';

export const uploads = new ObjectStorage('Uploads', { versioned: true });
```

`.dependsOn([uploads])` is what makes `services.uploads` exist and type, and
what tells the deploy target to grant that handler S3 access and nothing else.
Use [`FileServer`](/packages/constructs) instead when the objects are also
served on a domain.
:::

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
 // Get presigned download URL
const url = await storage.getDownloadURL({
  path: 'documents/report.pdf',
});

// Download as attachment with a custom filename
const attachmentUrl = await storage.getDownloadURL({
  path: 'documents/report.pdf',
  name: 'Q4-Report.pdf',
  // disposition defaults to 'attachment' when name is set
});

// Display inline in the browser (e.g. images, PDFs)
const inlineUrl = await storage.getDownloadURL({
  path: 'images/photo.jpg',
  disposition: 'inline',
});

// Override the response content type
const previewUrl = await storage.getDownloadURL({
  path: 'documents/report.pdf',
  disposition: 'inline',
  responseContentType: 'application/pdf',
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

## Storage URLs and credentials

A declared bucket reaches an app as one URL, `<ID>_URL`, and
`createStorageClient(url)` picks the driver by its scheme. An `s3://` URL
names the bucket as its host and the rest as query parameters:

```
s3://uploads?region=eu-west-1
s3://uploads?region=auto&endpoint=https://<account>.r2.cloudflarestorage.com
```

Credentials are optional, and come from one of two places:

- **The URL's userinfo** — `s3://KEY:SECRET@uploads?region=eu-west-1`. A key
  here signs for this bucket only and wins over anything in the environment.
  Percent-encode both halves: AWS secrets often contain `/` (`%2F`) and `+`
  (`%2B`). `s3Url.build` does this for you, and `s3Url.parse` decodes them.
- **The SDK's default chain** — for a URL with no userinfo: the shared
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, a profile, or an execution role.

```typescript
import { s3Url } from '@geekmidas/storage/aws';

s3Url.build({
  bucket: 'uploads',
  region: 'eu-west-1',
  accessKeyId: 'AKIA…',
  secretAccessKey: 'wJal/rXUt+nFEMI…',
});
// 's3://AKIA…:wJal%2FrXUt%2BnFEMI…@uploads?region=eu-west-1'
```

Prefer a key per bucket, scoped to that bucket, over one shared pair: an app
that reads two buckets then holds two narrow keys rather than one that opens
both. A URL with only one half of a pair (`s3://KEY@uploads`) is refused with
`IncompleteStorageCredentials` — it is never completed from the environment.

Every storage error that carries a URL (`MalformedStorageUrl`,
`UnexpectedStorageScheme`, `MissingStorageBucket`,
`UnregisteredStorageScheme`, `IncompleteStorageCredentials`) holds it with the
userinfo replaced by `REDACTED`, and its message never includes the URL.
`redactStorageUrl(url)` does the same for your own log lines.

## Tracing

`AmazonStorageClient` records a CLIENT span per call through the global
OpenTelemetry tracer — a no-op unless a provider is registered:

| Span | From | Attributes beyond `storage.system` (`s3`) and `storage.bucket` |
| --- | --- | --- |
| `storage.presign` | `getUploadURL`, `getUpload`, `getDownloadURL`, `getVersionDownloadURL` | `storage.presign.method` (`PUT`, `POST`, `GET`) |
| `storage.put` | `upload` | `storage.object.size`, `storage.object.content_type` |
| `storage.delete` | `delete` | |
| `storage.list` | `getVersions` | |

Never the object's key. A download URL served from the cache records no
presign span.

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
  path: string;                // S3 key
  name?: string;               // Filename for Content-Disposition header
  disposition?: 'inline' | 'attachment'; // Default: 'attachment' when name is set
  responseContentType?: string; // Override the response Content-Type
}

interface GetUploadParams {
  path: string;
  contentType: string;
  contentLength: number;
}
```

## Usage with Endpoints

```typescript
import { api } from '../constructs/api';
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

const uploadEndpoint = api
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
