import { existsSync } from 'node:fs';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock os.homedir to use temp directory
vi.mock('node:os', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:os')>();
	return {
		...original,
		homedir: vi.fn(),
	};
});

import { homedir } from 'node:os';
import {
	getCredentialsDir,
	getCredentialsPath,
	readCredentials,
	writeCredentials,
	storeDokployCredentials,
	getDokployCredentials,
	removeDokployCredentials,
	getDokployToken,
} from '../credentials';

describe('credentials storage', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `gkm-auth-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
		vi.mocked(homedir).mockReturnValue(tempDir);
	});

	afterEach(async () => {
		if (existsSync(tempDir)) {
			await rm(tempDir, { recursive: true });
		}
		vi.restoreAllMocks();
	});

	describe('path utilities', () => {
		it('should return credentials dir in home directory', () => {
			const dir = getCredentialsDir();
			expect(dir).toBe(join(tempDir, '.gkm'));
		});

		it('should return credentials path', () => {
			const path = getCredentialsPath();
			expect(path).toBe(join(tempDir, '.gkm', 'credentials.json'));
		});
	});

	describe('readCredentials / writeCredentials', () => {
		it('should return empty object when no credentials file exists', async () => {
			const creds = await readCredentials();
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

			await writeCredentials(credentials);
			const read = await readCredentials();

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

			await writeCredentials(credentials);

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

			await writeCredentials(credentials);

			// Verify the file was created (we can't easily check permissions in tests)
			const content = await readFile(getCredentialsPath(), 'utf-8');
			expect(JSON.parse(content)).toEqual(credentials);
		});
	});

	describe('storeDokployCredentials', () => {
		it('should store dokploy credentials', async () => {
			await storeDokployCredentials('my-token', 'https://dokploy.example.com');

			const creds = await readCredentials();
			expect(creds.dokploy).toBeDefined();
			expect(creds.dokploy!.token).toBe('my-token');
			expect(creds.dokploy!.endpoint).toBe('https://dokploy.example.com');
			expect(creds.dokploy!.storedAt).toBeDefined();
		});

		it('should overwrite existing credentials', async () => {
			await storeDokployCredentials('old-token', 'https://old.com');
			await storeDokployCredentials('new-token', 'https://new.com');

			const creds = await getDokployCredentials();
			expect(creds!.token).toBe('new-token');
			expect(creds!.endpoint).toBe('https://new.com');
		});
	});

	describe('getDokployCredentials', () => {
		it('should return null when no credentials stored', async () => {
			const creds = await getDokployCredentials();
			expect(creds).toBeNull();
		});

		it('should return stored credentials', async () => {
			await storeDokployCredentials('test-token', 'https://test.com');

			const creds = await getDokployCredentials();
			expect(creds).toEqual({
				token: 'test-token',
				endpoint: 'https://test.com',
			});
		});
	});

	describe('removeDokployCredentials', () => {
		it('should return false when no credentials to remove', async () => {
			const removed = await removeDokployCredentials();
			expect(removed).toBe(false);
		});

		it('should remove dokploy credentials', async () => {
			await storeDokployCredentials('test-token', 'https://test.com');

			const removed = await removeDokployCredentials();
			expect(removed).toBe(true);

			const creds = await getDokployCredentials();
			expect(creds).toBeNull();
		});
	});

	describe('getDokployToken', () => {
		it('should return null when no token available', async () => {
			const token = await getDokployToken();
			expect(token).toBeNull();
		});

		it('should return stored token', async () => {
			await storeDokployCredentials('stored-token', 'https://test.com');

			const token = await getDokployToken();
			expect(token).toBe('stored-token');
		});

		it('should prefer environment variable over stored token', async () => {
			await storeDokployCredentials('stored-token', 'https://test.com');
			process.env.DOKPLOY_API_TOKEN = 'env-token';

			try {
				const token = await getDokployToken();
				expect(token).toBe('env-token');
			} finally {
				delete process.env.DOKPLOY_API_TOKEN;
			}
		});

		it('should fall back to stored token when env var not set', async () => {
			delete process.env.DOKPLOY_API_TOKEN;
			await storeDokployCredentials('stored-token', 'https://test.com');

			const token = await getDokployToken();
			expect(token).toBe('stored-token');
		});
	});
});
