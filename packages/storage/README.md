# @geekmidas/storage

A comprehensive, type-safe storage client for cloud storage services with support for multiple providers and advanced features like versioning and presigned URLs.

## Features

- **Multi-provider support**: AWS S3, with extensible interface for Google Cloud Storage and Azure Blob Storage
- **Type-safe**: Full TypeScript support with comprehensive type definitions
- **Presigned URLs**: Generate secure upload and download URLs without exposing credentials
- **File versioning**: Support for retrieving and managing file versions
- **Direct uploads**: Upload files directly to storage without intermediate servers
- **Flexible configuration**: Support for custom endpoints (useful for MinIO, LocalStack, etc.)
- **Modern async/await API**: Promise-based interface throughout

## Installation

```bash
npm install @geekmidas/storage
```

### Peer Dependencies

For AWS S3 support, you'll need to install the AWS SDK v3 packages:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-presigned-post @aws-sdk/s3-request-presigner
```

## Quick Start

### AWS S3

```typescript
import { AmazonStorageClient } from '@geekmidas/storage/aws';

// Create client with credentials
const storage = AmazonStorageClient.create({
  bucket: 'my-bucket',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Upload a file directly
await storage.upload('documents/readme.txt', 'Hello, World!', 'text/plain');

// Generate a download URL
const downloadUrl = await storage.getDownloadURL({ 
  path: 'documents/readme.txt',
  name: 'README.txt' // Optional: sets Content-Disposition header
});

// Generate a presigned upload URL
const uploadUrl = await storage.getUploadURL({
  path: 'uploads/new-file.pdf',
  contentType: 'application/pdf',
  contentLength: 1024 * 1024, // 1MB
});
```

### MinIO / LocalStack

```typescript
import { AmazonStorageClient } from '@geekmidas/storage/aws';

// For local development with MinIO
const storage = AmazonStorageClient.create({
  bucket: 'test-bucket',
  region: 'us-east-1',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  endpoint: 'http://localhost:9000',
});
```

## API Reference

### StorageClient Interface

The core interface that all storage providers implement:

```typescript
interface StorageClient {
  readonly provider: StorageProvider;
  
  // Direct upload
  upload(key: string, data: string | Buffer, contentType: string): Promise<void>;
  
  // Download URLs
  getDownloadURL(file: File, expiresIn?: number): Promise<string>;
  
  // Upload URLs
  getUploadURL(params: GetUploadParams, expiresIn?: number): Promise<string>;
  getUpload(params: GetUploadParams, expiresIn?: number): Promise<GetUploadResponse>;
  
  // Versioning
  getVersions(key: string): Promise<DocumentVersion[]>;
  getVersionDownloadURL(file: File, versionId: string): Promise<string>;
}
```

### AmazonStorageClient

#### Factory Method

```typescript
AmazonStorageClient.create(options: AmazonStorageClientCreateOptions)
```

**Options:**
- `bucket` (required): S3 bucket name
- `region`: AWS region (default: uses AWS SDK default)
- `accessKeyId`: AWS access key ID
- `secretAccessKey`: AWS secret access key
- `endpoint`: Custom S3 endpoint (useful for MinIO, LocalStack)
- `acl`: Canned ACL for uploads (default: `authenticated-read`)

#### Methods

##### `upload(key: string, data: string | Buffer, contentType: string): Promise<void>`

Upload data directly to storage.

```typescript
// Upload text
await storage.upload('documents/hello.txt', 'Hello, World!', 'text/plain');

// Upload binary data
const buffer = Buffer.from('binary data');
await storage.upload('files/binary.dat', buffer, 'application/octet-stream');
```

##### `getDownloadURL(file: File, expiresIn?: number): Promise<string>`

Generate a presigned download URL.

```typescript
// Simple download URL
const url = await storage.getDownloadURL({ path: 'documents/file.pdf' });

// With custom filename in Content-Disposition
const url = await storage.getDownloadURL({ 
  path: 'documents/file.pdf',
  name: 'My Document.pdf'
});

// Custom expiration (in seconds)
const url = await storage.getDownloadURL({ path: 'documents/file.pdf' }, 3600);
```

##### `getUploadURL(params: GetUploadParams, expiresIn?: number): Promise<string>`

Generate a presigned PUT upload URL.

```typescript
const uploadUrl = await storage.getUploadURL({
  path: 'uploads/new-file.pdf',
  contentType: 'application/pdf',
  contentLength: 1024 * 1024,
});

// Use the URL to upload
const response = await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Length': '1048576',
  },
  body: fileData,
});
```

##### `getUpload(params: GetUploadParams, expiresIn?: number): Promise<GetUploadResponse>`

Generate a presigned POST upload with form fields.

```typescript
const upload = await storage.getUpload({
  path: 'uploads/form-upload.jpg',
  contentType: 'image/jpeg',
  contentLength: 500000,
});

// Use with HTML form
const formData = new FormData();
upload.fields.forEach(({ key, value }) => {
  formData.append(key, value);
});
formData.append('file', fileInput.files[0]);

const response = await fetch(upload.url, {
  method: 'POST',
  body: formData,
});
```

##### `getVersions(key: string): Promise<DocumentVersion[]>`

Get all versions of a file (requires S3 versioning).

```typescript
const versions = await storage.getVersions('documents/versioned-file.txt');
console.log(versions); // [{ id: 'version-1', createdAt: Date }, ...]
```

##### `getVersionDownloadURL(file: File, versionId: string): Promise<string>`

Generate download URL for a specific version.

```typescript
const url = await storage.getVersionDownloadURL(
  { path: 'documents/file.txt' },
  'version-12345'
);
```

### Types

#### File
```typescript
interface File {
  path: string;
  name?: string; // Optional display name for Content-Disposition
}
```

#### GetUploadParams
```typescript
interface GetUploadParams {
  path: string;
  contentType: string;
  contentLength: number;
}
```

#### DocumentVersion
```typescript
interface DocumentVersion {
  id: string;
  createdAt: Date;
}
```

#### StorageProvider
```typescript
enum StorageProvider {
  AWSS3 = 'geekimdas.toolbox.storage.aws.s3',
  GCP = 'geekimdas.toolbox.storage.gcp',
  AZURE = 'geekimdas.toolbox.storage.azure',
}
```

## Advanced Usage

### Custom S3 Client

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { AmazonStorageClient, AmazonCannedAccessControlList } from '@geekmidas/storage/aws';

const s3Client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const storage = new AmazonStorageClient(
  s3Client,
  'my-bucket',
  AmazonCannedAccessControlList.PublicRead
);
```

### Access Control Lists (ACLs)

```typescript
import { AmazonCannedAccessControlList } from '@geekmidas/storage/aws';

const storage = AmazonStorageClient.create({
  bucket: 'my-bucket',
  acl: AmazonCannedAccessControlList.PublicRead, // Files will be publicly readable
});
```

Available ACLs:
- `Private` - Owner gets full control, no one else has access
- `PublicRead` - Owner gets full control, everyone else gets read access
- `PublicReadWrite` - Owner gets full control, everyone else gets read/write access
- `AuthenticatedRead` - Owner gets full control, authenticated users get read access
- `BucketOwnerRead` - Object owner gets full control, bucket owner gets read access
- `BucketOwnerFullControl` - Object and bucket owner get full control
- `LogDeliveryWrite` - Log delivery service gets write access
- `AwsExecRead` - Amazon EC2 gets read access for AMI bundles

### Error Handling

```typescript
try {
  await storage.upload('documents/file.txt', 'content', 'text/plain');
} catch (error) {
  if (error.name === 'NoSuchBucket') {
    console.error('Bucket does not exist');
  } else if (error.name === 'AccessDenied') {
    console.error('Access denied');
  } else {
    console.error('Upload failed:', error);
  }
}
```

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only (requires MinIO)
npm run test:integration

# Run tests once
npm run test:once
```

### Local Development with MinIO

1. Start MinIO using Docker Compose:
   ```bash
   docker-compose up -d minio
   ```

2. MinIO will be available at:
   - API: http://localhost:9000
   - Console: http://localhost:9001
   - Credentials: minioadmin/minioadmin

3. Run integration tests:
   ```bash
   npm run test:integration
   ```

### Project Structure

```
src/
├── index.ts              # Main exports
├── aws.ts                # AWS-specific exports
├── StorageClient.ts      # Core interfaces and types
├── AmazonStorageClient.ts # AWS S3 implementation
└── __tests__/
    ├── StorageClient.spec.ts                    # Interface tests
    ├── AmazonStorageClient.spec.ts              # Unit tests
    └── AmazonStorageClient.integration.spec.ts  # Integration tests
```

## Contributing

1. Follow the existing code style (2 spaces, single quotes, semicolons)
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Use the "Integration over Unit" testing philosophy - prefer real dependencies over mocks

## License

MIT License - see the LICENSE file for details.