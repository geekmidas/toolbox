import { S3Client } from '@aws-sdk/client-s3';
import { InMemoryCache } from '@geekmidas/cache/memory';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	AmazonCannedAccessControlList,
	AmazonStorageClient,
} from '../AmazonStorageClient';
import { StorageProvider } from '../StorageClient';

describe('AmazonStorageClient Integration Tests', () => {
	let client: AmazonStorageClient;
	const testBucket = 'geekmidas';
	const testKey = 'test-files/test.txt';
	const testContent = 'Hello, World!';
	const testContentType = 'text/plain';

	beforeAll(async () => {
		// Create storage client pointing to MinIO
		client = AmazonStorageClient.create({
			bucket: testBucket,
			region: 'us-east-1',
			accessKeyId: 'geekmidas',
			secretAccessKey: 'geekmidas',
			endpoint: 'http://localhost:9000',
			acl: AmazonCannedAccessControlList.PublicRead,
			forcePathStyle: true,
		});

		// Wait for MinIO to be ready
		await new Promise((resolve) => setTimeout(resolve, 2000));
	});

	describe('provider property', () => {
		it('should return AWS S3 provider', () => {
			expect(client.provider).toBe(StorageProvider.AWSS3);
		});
	});

	describe('upload and download workflow', () => {
		it.skip('should upload a file directly and generate download URL', async () => {
			// Upload file directly
			await client.upload(testKey, testContent, testContentType);

			// Generate download URL
			const downloadUrl = await client.getDownloadURL({ path: testKey });

			expect(downloadUrl).toMatch(
				/^http:\/\/localhost:9000\/geekmidas\/test-files\/test\.txt/,
			);
			expect(downloadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
			expect(downloadUrl).toContain('X-Amz-Credential=');
			expect(downloadUrl).toContain('X-Amz-Date=');
			expect(downloadUrl).toContain('X-Amz-SignedHeaders=');
			expect(downloadUrl).toContain('X-Amz-Signature=');

			// Verify file can be downloaded
			const response = await fetch(downloadUrl);
			expect(response.ok).toBe(true);

			const downloadedContent = await response.text();
			expect(downloadedContent).toBe(testContent);
		});

		it('should upload a file with filename and generate download URL with content disposition', async () => {
			const keyWithName = 'test-files/named-file.txt';
			const fileName = 'my-document.txt';

			await client.upload(keyWithName, testContent, testContentType);

			const downloadUrl = await client.getDownloadURL({
				path: keyWithName,
				name: fileName,
			});

			expect(downloadUrl).toContain(
				'response-content-disposition=attachment%3B%20filename%3Dmy-document.txt',
			);
		});

		it('should handle binary data upload', async () => {
			const binaryKey = 'test-files/binary.bin';
			const binaryData = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in bytes

			await client.upload(binaryKey, binaryData, 'application/octet-stream');

			const downloadUrl = await client.getDownloadURL({ path: binaryKey });
			const response = await fetch(downloadUrl);
			const downloadedBuffer = await response.arrayBuffer();

			expect(new Uint8Array(downloadedBuffer)).toEqual(
				new Uint8Array(binaryData),
			);
		});
	});

	describe('presigned upload URLs', () => {
		it('should generate presigned PUT upload URL', async () => {
			const uploadKey = 'test-files/presigned-upload.txt';
			const uploadUrl = await client.getUploadURL({
				path: uploadKey,
				contentType: testContentType,
				contentLength: testContent.length,
			});

			expect(uploadUrl).toMatch(
				/^http:\/\/localhost:9000\/geekmidas\/test-files\/presigned-upload\.txt/,
			);
			expect(uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');

			// Test actual upload using the presigned URL
			const uploadResponse = await fetch(uploadUrl, {
				method: 'PUT',
				headers: {
					'Content-Type': testContentType,
					'Content-Length': testContent.length.toString(),
				},
				body: testContent,
			});

			expect(uploadResponse.ok).toBe(true);

			// Verify file was uploaded
			const downloadUrl = await client.getDownloadURL({ path: uploadKey });
			const downloadResponse = await fetch(downloadUrl);
			const downloadedContent = await downloadResponse.text();
			expect(downloadedContent).toBe(testContent);
		});

		it('should generate presigned POST upload with form fields', async () => {
			const uploadKey = 'test-files/presigned-post.txt';
			const uploadData = await client.getUpload({
				path: uploadKey,
				contentType: testContentType,
				contentLength: testContent.length,
			});

			expect(uploadData.url).toBe('http://localhost:9000/geekmidas');
			expect(uploadData.fields).toContainEqual({
				key: 'key',
				value: uploadKey,
			});
			expect(uploadData.fields).toContainEqual({
				key: 'acl',
				value: 'public-read',
			});

			// Test actual upload using the presigned POST
			const formData = new FormData();
			uploadData.fields.forEach(({ key, value }) => {
				formData.append(key, value);
			});
			formData.append(
				'file',
				new Blob([testContent], { type: testContentType }),
			);

			const uploadResponse = await fetch(uploadData.url, {
				method: 'POST',
				body: formData,
			});

			expect(uploadResponse.ok).toBe(true);

			// Verify file was uploaded
			const downloadUrl = await client.getDownloadURL({ path: uploadKey });
			const downloadResponse = await fetch(downloadUrl);
			const downloadedContent = await downloadResponse.blob();
			expect(downloadedContent).toEqual(
				new Blob([testContent], { type: testContentType }),
			);
		});
	});

	describe('versioning', () => {
		it('should handle file versions', async () => {
			const versionKey = 'test-files/versioned.txt';
			const content1 = 'Version 1';
			const content2 = 'Version 2';

			// Upload first version
			await client.upload(versionKey, content1, testContentType);

			// Upload second version
			await client.upload(versionKey, content2, testContentType);

			// Get versions - MinIO might not enable versioning by default
			// This test verifies the method works even if versioning is not enabled
			const versions = await client.getVersions(versionKey);
			expect(Array.isArray(versions)).toBe(true);

			// If versioning is enabled, we should have multiple versions
			// If not, we should have at least the current version
			if (versions.length > 0) {
				expect(versions[0]).toHaveProperty('id');
				expect(versions[0]).toHaveProperty('createdAt');
				expect(versions[0].createdAt).toBeInstanceOf(Date);
			}
		});
	});

	describe('error handling', () => {
		it('should handle download URL generation for non-existent files', async () => {
			// This should not throw - presigned URLs can be generated for non-existent files
			const downloadUrl = await client.getDownloadURL({
				path: 'non-existent/file.txt',
			});
			expect(downloadUrl).toMatch(
				/^http:\/\/localhost:9000\/geekmidas\/non-existent\/file\.txt/,
			);

			// But accessing the URL should return 404
			const response = await fetch(downloadUrl);
			expect(response.status).toBe(404);
		});
	});

	describe('custom expiration times', () => {
		it('should respect custom expiration for download URLs', async () => {
			const key = 'test-files/expiration-test.txt';
			await client.upload(key, testContent, testContentType);

			const shortExpirationUrl = await client.getDownloadURL({ path: key }, 1); // 1 second
			const longExpirationUrl = await client.getDownloadURL(
				{ path: key },
				3600,
			); // 1 hour

			expect(shortExpirationUrl).toContain('X-Amz-Expires=1');
			expect(longExpirationUrl).toContain('X-Amz-Expires=3600');
		});

		it('should respect custom expiration for upload URLs', async () => {
			const key = 'test-files/upload-expiration-test.txt';

			const shortExpirationUrl = await client.getUploadURL(
				{
					path: key,
					contentType: testContentType,
					contentLength: testContent.length,
				},
				1,
			); // 1 second

			const longExpirationUrl = await client.getUploadURL(
				{
					path: key,
					contentType: testContentType,
					contentLength: testContent.length,
				},
				3600,
			); // 1 hour

			expect(shortExpirationUrl).toContain('X-Amz-Expires=1');
			expect(longExpirationUrl).toContain('X-Amz-Expires=3600');
		});
	});

	describe('factory method', () => {
		it('should create client with minimal configuration', () => {
			const minimalClient = AmazonStorageClient.create({
				bucket: 'geekmidas',
			});

			expect(minimalClient).toBeInstanceOf(AmazonStorageClient);
			expect(minimalClient.provider).toBe(StorageProvider.AWSS3);
		});

		it('should create client with full configuration', () => {
			const fullClient = AmazonStorageClient.create({
				bucket: 'geekmidas',
				region: 'us-west-2',
				accessKeyId: 'test-key',
				secretAccessKey: 'test-secret',
				endpoint: 'https://custom-s3.example.com',
				acl: AmazonCannedAccessControlList.Private,
			});

			expect(fullClient).toBeInstanceOf(AmazonStorageClient);
			expect(fullClient.provider).toBe(StorageProvider.AWSS3);
		});
	});

	describe('different ACL configurations', () => {
		it('should work with different ACL settings', async () => {
			const privateClient = AmazonStorageClient.create({
				bucket: testBucket,
				region: 'us-east-1',
				accessKeyId: 'minioadmin',
				secretAccessKey: 'minioadmin',
				endpoint: 'http://localhost:9000',
				acl: AmazonCannedAccessControlList.Private,
			});

			const uploadData = await privateClient.getUpload({
				path: 'test-files/private.txt',
				contentType: testContentType,
				contentLength: testContent.length,
			});

			expect(uploadData.fields).toContainEqual({
				key: 'acl',
				value: 'private',
			});
		});
	});

	describe('S3Client integration', () => {
		it('should work with externally created S3Client', () => {
			const s3Client = new S3Client({
				region: 'us-east-1',
				credentials: {
					accessKeyId: 'minioadmin',
					secretAccessKey: 'minioadmin',
				},
				endpoint: 'http://localhost:9000',
			});

			const storageClient = new AmazonStorageClient(
				s3Client,
				testBucket,
				AmazonCannedAccessControlList.PublicRead,
			);

			expect(storageClient).toBeInstanceOf(AmazonStorageClient);
			expect(storageClient.provider).toBe(StorageProvider.AWSS3);
		});
	});

	describe('cache functionality', () => {
		it('should cache download URLs', async () => {
			const cache = new InMemoryCache<string>();
			const clientWithCache = AmazonStorageClient.create({
				bucket: testBucket,
				region: 'us-east-1',
				accessKeyId: 'geekmidas',
				secretAccessKey: 'geekmidas',
				endpoint: 'http://localhost:9000',
				forcePathStyle: true,
				cache,
			});

			const key = 'test-files/cache-test.txt';
			await clientWithCache.upload(key, testContent, testContentType);

			// First call should generate and cache the URL
			const url1 = await clientWithCache.getDownloadURL({ path: key });

			// Second call should return the cached URL
			const url2 = await clientWithCache.getDownloadURL({ path: key });

			// URLs should be identical (same cached value)
			expect(url1).toBe(url2);

			// Verify the URL was cached
			const cacheKey = `download-url:${key}`;
			const cachedUrl = await cache.get(cacheKey);
			expect(cachedUrl).toBe(url1);
		});

		it('should respect cache expiration based on URL expiry', async () => {
			const cache = new InMemoryCache<string>();
			const clientWithCache = AmazonStorageClient.create({
				bucket: testBucket,
				region: 'us-east-1',
				accessKeyId: 'geekmidas',
				secretAccessKey: 'geekmidas',
				endpoint: 'http://localhost:9000',
				forcePathStyle: true,
				cache,
			});

			const key = 'test-files/cache-expiry.txt';
			await clientWithCache.upload(key, testContent, testContentType);

			// Generate URL with short expiry that won't be cached
			await clientWithCache.getDownloadURL({ path: key }, 30); // 30 seconds

			// Check cache doesn't contain the URL (too short to cache)
			const cacheKey = `download-url:${key}`;
			const cachedShortUrl = await cache.get(cacheKey);
			expect(cachedShortUrl).toBeUndefined();

			// Generate URL with longer expiry that will be cached
			const longExpiryUrl = await clientWithCache.getDownloadURL(
				{ path: key },
				3600,
			); // 1 hour

			// Check cache contains the URL
			const cachedLongUrl = await cache.get(cacheKey);
			expect(cachedLongUrl).toBe(longExpiryUrl);
		});

		it('should use cached URL when available', async () => {
			const cache = new InMemoryCache<string>();
			const clientWithCache = AmazonStorageClient.create({
				bucket: testBucket,
				region: 'us-east-1',
				accessKeyId: 'geekmidas',
				secretAccessKey: 'geekmidas',
				endpoint: 'http://localhost:9000',
				forcePathStyle: true,
				cache,
			});

			const key = 'test-files/pre-cached.txt';
			const cachedUrl = 'https://pre-cached-url.example.com';
			const cacheKey = `download-url:${key}`;

			// Pre-populate cache
			await cache.set(cacheKey, cachedUrl);

			// Get download URL should return cached value
			const url = await clientWithCache.getDownloadURL({ path: key });
			expect(url).toBe(cachedUrl);
		});

		it('should work without cache', async () => {
			// Client without cache should work normally
			const clientNoCache = AmazonStorageClient.create({
				bucket: testBucket,
				region: 'us-east-1',
				accessKeyId: 'geekmidas',
				secretAccessKey: 'geekmidas',
				endpoint: 'http://localhost:9000',
				forcePathStyle: true,
			});

			const key = 'test-files/no-cache.txt';
			await clientNoCache.upload(key, testContent, testContentType);

			const url1 = await clientNoCache.getDownloadURL({ path: key });
			const url2 = await clientNoCache.getDownloadURL({ path: key });

			// Without cache, new URLs might be generated each time
			// Both should be valid URLs
			expect(url1).toMatch(
				/^http:\/\/localhost:9000\/geekmidas\/test-files\/no-cache\.txt/,
			);
			expect(url2).toMatch(
				/^http:\/\/localhost:9000\/geekmidas\/test-files\/no-cache\.txt/,
			);
		});

		it('should pass cache to constructor', () => {
			const cache = new InMemoryCache<string>();
			const s3Client = new S3Client({
				region: 'us-east-1',
				credentials: {
					accessKeyId: 'geekmidas',
					secretAccessKey: 'geekmidas',
				},
				endpoint: 'http://localhost:9000',
				forcePathStyle: true,
			});

			const clientWithCache = new AmazonStorageClient(
				s3Client,
				testBucket,
				AmazonCannedAccessControlList.PublicRead,
				cache,
			);

			expect(clientWithCache.cache).toBe(cache);
		});
	});

	describe('getVersionDownloadURL', () => {
		it('should generate version-specific download URL', async () => {
			const versionKey = 'test-files/version-download.txt';
			const versionId = 'test-version-id';

			// Upload a file first
			await client.upload(versionKey, testContent, testContentType);

			// Generate version-specific download URL
			const downloadUrl = await client.getVersionDownloadURL(
				{ path: versionKey, name: 'versioned-file.txt' },
				versionId,
			);

			expect(downloadUrl).toMatch(
				/^http:\/\/localhost:9000\/geekmidas\/test-files\/version-download\.txt/,
			);
			expect(downloadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
			expect(downloadUrl).toContain(
				'response-content-disposition=attachment%3B%20filename%3Dversioned-file.txt',
			);
		});

		it('should generate version URL without filename', async () => {
			const versionKey = 'test-files/version-no-name.txt';
			const versionId = 'test-version-id';

			// Upload a file first
			await client.upload(versionKey, testContent, testContentType);

			// Generate version-specific download URL without filename
			const downloadUrl = await client.getVersionDownloadURL(
				{ path: versionKey },
				versionId,
			);

			expect(downloadUrl).toMatch(
				/^http:\/\/localhost:9000\/geekmidas\/test-files\/version-no-name\.txt/,
			);
			expect(downloadUrl).not.toContain('response-content-disposition');
		});
	});
});
