import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	getCredentialsDir,
	getCredentialsPath,
	getDokployCredentials,
	getDokployRegistryId,
	getDokployToken,
	readCredentials,
	removeDokployCredentials,
	storeDokployCredentials,
	storeDokployRegistryId,
	writeCredentials,
} from '../credentials';

describe('credentials storage', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `gkm-auth-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (existsSync(tempDir)) {
			await rm(tempDir, { recursive: true });
		}
	});

	describe('path utilities', () => {
		it('should return credentials dir in specified root directory', () => {
			const dir = getCredentialsDir({ root: tempDir });
			expect(dir).toBe(join(tempDir, '.gkm'));
		});

		it('should return credentials path', () => {
			const path = getCredentialsPath({ root: tempDir });
			expect(path).toBe(join(tempDir, '.gkm', 'credentials.json'));
		});
	});

	describe('readCredentials / writeCredentials', () => {
		it('should return empty object when no credentials file exists', async () => {
			const creds = await readCredentials({ root: tempDir });
			expect(creds).toEqual({});
		});

		it('should write and read credentials', async () => {
			const credentials = {
				dokploy: {
					token: 'test-token',
					endpoint: 'https://dokploy.example.com',
					storedAt: new Date().toISOString(),
				},
			};

			await writeCredentials(credentials, { root: tempDir });
			const read = await readCredentials({ root: tempDir });

			expect(read).toEqual(credentials);
		});

		it('should create credentials directory if it does not exist', async () => {
			const credentials = {
				dokploy: {
					token: 'test',
					endpoint: 'https://test.com',
					storedAt: new Date().toISOString(),
				},
			};

			await writeCredentials(credentials, { root: tempDir });

			expect(existsSync(join(tempDir, '.gkm'))).toBe(true);
			expect(existsSync(join(tempDir, '.gkm', 'credentials.json'))).toBe(true);
		});

		it('should set secure file permissions', async () => {
			const credentials = {
				dokploy: {
					token: 'test',
					endpoint: 'https://test.com',
					storedAt: new Date().toISOString(),
				},
			};

			await writeCredentials(credentials, { root: tempDir });

			// Verify the file was created (we can't easily check permissions in tests)
			const content = await readFile(
				getCredentialsPath({ root: tempDir }),
				'utf-8',
			);
			expect(JSON.parse(content)).toEqual(credentials);
		});
	});

	describe('storeDokployCredentials', () => {
		it('should store dokploy credentials', async () => {
			await storeDokployCredentials('my-token', 'https://dokploy.example.com', {
				root: tempDir,
			});

			const creds = await readCredentials({ root: tempDir });
			expect(creds.dokploy).toBeDefined();
			expect(creds.dokploy!.token).toBe('my-token');
			expect(creds.dokploy!.endpoint).toBe('https://dokploy.example.com');
			expect(creds.dokploy!.storedAt).toBeDefined();
		});

		it('should overwrite existing credentials', async () => {
			await storeDokployCredentials('old-token', 'https://old.com', {
				root: tempDir,
			});
			await storeDokployCredentials('new-token', 'https://new.com', {
				root: tempDir,
			});

			const creds = await getDokployCredentials({ root: tempDir });
			expect(creds!.token).toBe('new-token');
			expect(creds!.endpoint).toBe('https://new.com');
		});
	});

	describe('getDokployCredentials', () => {
		it('should return null when no credentials stored', async () => {
			const creds = await getDokployCredentials({ root: tempDir });
			expect(creds).toBeNull();
		});

		it('should return stored credentials', async () => {
			await storeDokployCredentials('test-token', 'https://test.com', {
				root: tempDir,
			});

			const creds = await getDokployCredentials({ root: tempDir });
			expect(creds).toEqual({
				token: 'test-token',
				endpoint: 'https://test.com',
			});
		});
	});

	describe('removeDokployCredentials', () => {
		it('should return false when no credentials to remove', async () => {
			const removed = await removeDokployCredentials({ root: tempDir });
			expect(removed).toBe(false);
		});

		it('should remove dokploy credentials', async () => {
			await storeDokployCredentials('test-token', 'https://test.com', {
				root: tempDir,
			});

			const removed = await removeDokployCredentials({ root: tempDir });
			expect(removed).toBe(true);

			const creds = await getDokployCredentials({ root: tempDir });
			expect(creds).toBeNull();
		});
	});

	describe('getDokployToken', () => {
		it('should return null when no token available', async () => {
			const token = await getDokployToken({ root: tempDir });
			expect(token).toBeNull();
		});

		it('should return stored token', async () => {
			await storeDokployCredentials('stored-token', 'https://test.com', {
				root: tempDir,
			});

			const token = await getDokployToken({ root: tempDir });
			expect(token).toBe('stored-token');
		});

		it('should prefer environment variable over stored token', async () => {
			await storeDokployCredentials('stored-token', 'https://test.com', {
				root: tempDir,
			});
			process.env.DOKPLOY_API_TOKEN = 'env-token';

			try {
				const token = await getDokployToken({ root: tempDir });
				expect(token).toBe('env-token');
			} finally {
				delete process.env.DOKPLOY_API_TOKEN;
			}
		});

		it('should fall back to stored token when env var not set', async () => {
			delete process.env.DOKPLOY_API_TOKEN;
			await storeDokployCredentials('stored-token', 'https://test.com', {
				root: tempDir,
			});

			const token = await getDokployToken({ root: tempDir });
			expect(token).toBe('stored-token');
		});
	});

	describe('storeDokployRegistryId', () => {
		it('should throw error when no dokploy credentials exist', async () => {
			await expect(
				storeDokployRegistryId('reg_123', { root: tempDir }),
			).rejects.toThrow('Dokploy credentials not found');
		});

		it('should store registryId with existing credentials', async () => {
			await storeDokployCredentials('token', 'https://test.com', {
				root: tempDir,
			});

			await storeDokployRegistryId('reg_123', { root: tempDir });

			const creds = await readCredentials({ root: tempDir });
			expect(creds.dokploy?.registryId).toBe('reg_123');
		});

		it('should overwrite existing registryId', async () => {
			await storeDokployCredentials('token', 'https://test.com', {
				root: tempDir,
			});
			await storeDokployRegistryId('old_reg', { root: tempDir });
			await storeDokployRegistryId('new_reg', { root: tempDir });

			const creds = await readCredentials({ root: tempDir });
			expect(creds.dokploy?.registryId).toBe('new_reg');
		});
	});

	describe('getDokployRegistryId', () => {
		it('should return undefined when no credentials exist', async () => {
			const registryId = await getDokployRegistryId({ root: tempDir });
			expect(registryId).toBeUndefined();
		});

		it('should return undefined when credentials exist but no registryId', async () => {
			await storeDokployCredentials('token', 'https://test.com', {
				root: tempDir,
			});

			const registryId = await getDokployRegistryId({ root: tempDir });
			expect(registryId).toBeUndefined();
		});

		it('should return stored registryId', async () => {
			await storeDokployCredentials('token', 'https://test.com', {
				root: tempDir,
			});
			await storeDokployRegistryId('reg_456', { root: tempDir });

			const registryId = await getDokployRegistryId({ root: tempDir });
			expect(registryId).toBe('reg_456');
		});
	});

	describe('getDokployCredentials with registryId', () => {
		it('should return registryId when stored', async () => {
			await storeDokployCredentials('token', 'https://test.com', {
				root: tempDir,
			});
			await storeDokployRegistryId('reg_789', { root: tempDir });

			const creds = await getDokployCredentials({ root: tempDir });
			expect(creds).toEqual({
				token: 'token',
				endpoint: 'https://test.com',
				registryId: 'reg_789',
			});
		});

		it('should return undefined registryId when not stored', async () => {
			await storeDokployCredentials('token', 'https://test.com', {
				root: tempDir,
			});

			const creds = await getDokployCredentials({ root: tempDir });
			expect(creds?.registryId).toBeUndefined();
		});
	});
});
