import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	ensureTestDatabase,
	rewriteDatabaseUrlForTests,
} from '../index';

describe('rewriteDatabaseUrlForTests', () => {
	beforeAll(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	it('should append _test to DATABASE_URL database name', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/myapp',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/myapp_test',
		);
	});

	it('should handle URL-encoded passwords', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL:
				'postgresql://app:p%40ssw0rd@localhost:5432/myapp',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:p%40ssw0rd@localhost:5432/myapp_test',
		);
	});

	it('should handle non-default ports', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5433/myapp',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5433/myapp_test',
		);
	});

	it('should not double-append _test if already present', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/myapp_test',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/myapp_test',
		);
	});

	it('should rewrite all keys containing DATABASE_URL', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/app',
			API_DATABASE_URL: 'postgresql://app:secret@localhost:5432/api',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/app_test',
		);
		expect(result.API_DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/api_test',
		);
	});

	it('should skip non-DATABASE_URL keys', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/app',
			REDIS_URL: 'redis://:secret@localhost:6379',
			API_KEY: 'sk-12345',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/app_test',
		);
		expect(result.REDIS_URL).toBe('redis://:secret@localhost:6379');
		expect(result.API_KEY).toBe('sk-12345');
	});

	it('should skip invalid URLs gracefully', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'not-a-url',
		});
		expect(result.DATABASE_URL).toBe('not-a-url');
	});

	it('should skip URLs without a database name', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/',
		);
	});

	it('should return empty object for empty input', () => {
		const result = rewriteDatabaseUrlForTests({});
		expect(result).toEqual({});
	});

	it('should not mutate the original object', () => {
		const original = {
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/app',
		};
		const result = rewriteDatabaseUrlForTests(original);
		expect(original.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/app',
		);
		expect(result).not.toBe(original);
	});
});

describe('ensureTestDatabase', () => {
	beforeAll(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	it('should do nothing when DATABASE_URL is missing', async () => {
		// Should resolve without error
		await ensureTestDatabase({});
		await ensureTestDatabase({ REDIS_URL: 'redis://localhost:6379' });
	});

	it('should do nothing when database name is empty', async () => {
		await ensureTestDatabase({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/',
		});
	});

	it('should not throw when postgres is unreachable', async () => {
		// Use a port that's almost certainly not running postgres
		await ensureTestDatabase({
			DATABASE_URL: 'postgresql://app:secret@localhost:59999/test_db',
		});
		// Should log a warning but not throw
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining('Could not ensure test database'),
		);
	});
});
