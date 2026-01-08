import { describe, expect, it } from 'vitest';
import { StorageProvider } from '../StorageClient';

describe('StorageClient', () => {
	describe('StorageProvider enum', () => {
		it('should have correct provider values', () => {
			expect(StorageProvider.AWSS3).toBe('geekimdas.toolbox.storage.aws.s3');
			expect(StorageProvider.GCP).toBe('geekimdas.toolbox.storage.gcp');
			expect(StorageProvider.AZURE).toBe('geekimdas.toolbox.storage.azure');
		});

		it('should have unique provider values', () => {
			const values = Object.values(StorageProvider);
			const uniqueValues = new Set(values);
			expect(uniqueValues.size).toBe(values.length);
		});
	});

	describe('interfaces', () => {
		it('should define DocumentVersion interface correctly', () => {
			// This is a compile-time test to ensure the interface exists
			// and has the correct shape
			const version: import('../StorageClient').DocumentVersion = {
				id: 'test-id',
				createdAt: new Date(),
			};

			expect(version.id).toBe('test-id');
			expect(version.createdAt).toBeInstanceOf(Date);
		});

		it('should define File interface correctly', () => {
			const file: import('../StorageClient').File = {
				path: 'test/path.txt',
			};

			expect(file.path).toBe('test/path.txt');
			expect(file.name).toBeUndefined();

			const fileWithName: import('../StorageClient').File = {
				path: 'test/path.txt',
				name: 'display-name.txt',
			};

			expect(fileWithName.path).toBe('test/path.txt');
			expect(fileWithName.name).toBe('display-name.txt');
		});

		it('should define GetUploadParams interface correctly', () => {
			const params: import('../StorageClient').GetUploadParams = {
				path: 'test/upload.txt',
				contentType: 'text/plain',
				contentLength: 100,
			};

			expect(params.path).toBe('test/upload.txt');
			expect(params.contentType).toBe('text/plain');
			expect(params.contentLength).toBe(100);
		});

		it('should define GetUploadResponse interface correctly', () => {
			const response: import('../StorageClient').GetUploadResponse = {
				url: 'https://example.com/upload',
				fields: [
					{ key: 'key', value: 'test/path.txt' },
					{ key: 'acl', value: 'public-read' },
				],
			};

			expect(response.url).toBe('https://example.com/upload');
			expect(response.fields).toHaveLength(2);
			expect(response.fields[0]).toEqual({
				key: 'key',
				value: 'test/path.txt',
			});
			expect(response.fields[1]).toEqual({ key: 'acl', value: 'public-read' });
		});

		it('should define UploadField type correctly', () => {
			const field: import('../StorageClient').UploadField = {
				key: 'test-key',
				value: 'test-value',
			};

			expect(field.key).toBe('test-key');
			expect(field.value).toBe('test-value');
		});
	});
});
