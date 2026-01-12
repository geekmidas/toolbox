import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	getDokployCredentials,
	removeDokployCredentials,
	storeDokployCredentials,
} from '../credentials';
import { maskToken, validateDokployToken } from '../index';

// MSW server for mocking API calls
const server = setupServer();

describe('auth commands', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `gkm-auth-cmd-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
		server.listen({ onUnhandledRequest: 'bypass' });
	});

	afterEach(async () => {
		server.resetHandlers();
		server.close();
		if (existsSync(tempDir)) {
			await rm(tempDir, { recursive: true });
		}
	});

	describe('validateDokployToken', () => {
		it('should return true for valid token', async () => {
			server.use(
				http.get('https://dokploy.example.com/api/project.all', () => {
					return HttpResponse.json([{ projectId: 'proj_1', name: 'Test' }]);
				}),
			);

			const result = await validateDokployToken(
				'https://dokploy.example.com',
				'valid-token',
			);

			expect(result).toBe(true);
		});

		it('should return false for invalid token (401)', async () => {
			server.use(
				http.get('https://dokploy.example.com/api/project.all', () => {
					return new HttpResponse(null, { status: 401 });
				}),
			);

			const result = await validateDokployToken(
				'https://dokploy.example.com',
				'invalid-token',
			);

			expect(result).toBe(false);
		});

		it('should return false for server error (500)', async () => {
			server.use(
				http.get('https://dokploy.example.com/api/project.all', () => {
					return new HttpResponse(null, { status: 500 });
				}),
			);

			const result = await validateDokployToken(
				'https://dokploy.example.com',
				'token',
			);

			expect(result).toBe(false);
		});

		it('should return false on network error', async () => {
			server.use(
				http.get('https://dokploy.example.com/api/project.all', () => {
					return HttpResponse.error();
				}),
			);

			const result = await validateDokployToken(
				'https://dokploy.example.com',
				'token',
			);

			expect(result).toBe(false);
		});
	});

	describe('maskToken', () => {
		it('should mask long tokens showing first and last 4 chars', () => {
			expect(maskToken('abcdefghijklmnop')).toBe('abcd...mnop');
		});

		it('should fully mask tokens 8 chars or less', () => {
			expect(maskToken('short')).toBe('****');
			expect(maskToken('12345678')).toBe('****');
		});

		it('should handle exactly 9 character token', () => {
			expect(maskToken('123456789')).toBe('1234...6789');
		});

		it('should handle very long tokens', () => {
			const longToken = 'a'.repeat(100);
			expect(maskToken(longToken)).toBe('aaaa...aaaa');
		});

		it('should handle empty string', () => {
			expect(maskToken('')).toBe('****');
		});
	});

	describe('credentials flow', () => {
		it('should store and retrieve credentials', async () => {
			await storeDokployCredentials('my-token', 'https://dokploy.example.com', {
				root: tempDir,
			});

			const creds = await getDokployCredentials({ root: tempDir });
			expect(creds).not.toBeNull();
			expect(creds!.token).toBe('my-token');
			expect(creds!.endpoint).toBe('https://dokploy.example.com');
		});

		it('should remove credentials', async () => {
			await storeDokployCredentials('my-token', 'https://dokploy.example.com', {
				root: tempDir,
			});

			const removed = await removeDokployCredentials({ root: tempDir });
			expect(removed).toBe(true);

			const creds = await getDokployCredentials({ root: tempDir });
			expect(creds).toBeNull();
		});

		it('should return false when removing non-existent credentials', async () => {
			const removed = await removeDokployCredentials({ root: tempDir });
			expect(removed).toBe(false);
		});
	});
});

describe('URL normalization', () => {
	it('should remove trailing slash from endpoint', () => {
		const endpoint = 'https://dokploy.example.com/'.replace(/\/$/, '');
		expect(endpoint).toBe('https://dokploy.example.com');
	});

	it('should not modify endpoint without trailing slash', () => {
		const endpoint = 'https://dokploy.example.com'.replace(/\/$/, '');
		expect(endpoint).toBe('https://dokploy.example.com');
	});

	it('should validate URL format', () => {
		expect(() => new URL('https://dokploy.example.com')).not.toThrow();
		expect(() => new URL('invalid-url')).toThrow();
	});
});
