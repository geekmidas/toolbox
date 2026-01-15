import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { formatParseError, isDevelopment } from '../formatter';

// Helper to create test issues - casts through unknown because we're creating test fixtures
// that may include properties like 'received' which vary by issue type
function createIssue(issue: Record<string, unknown>): z.core.$ZodIssue {
	return issue as unknown as z.core.$ZodIssue;
}

describe('formatParseError', () => {
	it('should format missing variables', () => {
		const error = new z.ZodError([
			createIssue({
				code: 'invalid_type',
				expected: 'string',
				received: 'undefined',
				path: ['DATABASE_URL'],
				message: 'Environment variable "DATABASE_URL": Required',
			}),
			createIssue({
				code: 'invalid_type',
				expected: 'string',
				received: 'undefined',
				path: ['JWT_SECRET'],
				message: 'Environment variable "JWT_SECRET": Required',
			}),
		]);

		const formatted = formatParseError(error, { colors: false });

		expect(formatted).toContain('Environment Configuration Failed');
		expect(formatted).toContain('Missing Variables:');
		expect(formatted).toContain('DATABASE_URL');
		expect(formatted).toContain('JWT_SECRET');
		expect(formatted).toContain('Required');
	});

	it('should format invalid values', () => {
		const error = new z.ZodError([
			createIssue({
				code: 'invalid_value',
				values: ['development', 'staging', 'production'],
				received: 'invalid',
				path: ['NODE_ENV'],
				message:
					'Invalid enum value. Expected \'development\' | \'staging\' | \'production\', received \'invalid\'',
			}),
		]);

		const formatted = formatParseError(error, { colors: false });

		expect(formatted).toContain('Environment Configuration Failed');
		expect(formatted).toContain('Invalid Values:');
		expect(formatted).toContain('NODE_ENV');
		expect(formatted).toContain('invalid');
	});

	it('should handle mixed missing and invalid values', () => {
		const error = new z.ZodError([
			createIssue({
				code: 'invalid_type',
				expected: 'string',
				received: 'undefined',
				path: ['DATABASE_URL'],
				message: 'Environment variable "DATABASE_URL": Required',
			}),
			createIssue({
				code: 'invalid_type',
				expected: 'number',
				received: 'string',
				path: ['PORT'],
				message: 'Expected number, received string',
			}),
		]);

		const formatted = formatParseError(error, { colors: false });

		expect(formatted).toContain('Missing Variables:');
		expect(formatted).toContain('DATABASE_URL');
		expect(formatted).toContain('Invalid Values:');
		expect(formatted).toContain('PORT');
	});

	it('should clean message prefixes', () => {
		const error = new z.ZodError([
			createIssue({
				code: 'invalid_type',
				expected: 'number',
				received: 'string',
				path: ['PORT'],
				message: 'Environment variable "PORT": Expected number, received string',
			}),
		]);

		const formatted = formatParseError(error, { colors: false });

		// Should not duplicate "Environment variable" in output
		expect(formatted).not.toContain(
			'Environment variable "PORT": Environment variable',
		);
		expect(formatted).toContain('Expected number, received string');
	});

	it('should extract env name from message when path is empty', () => {
		const error = new z.ZodError([
			createIssue({
				code: 'invalid_type',
				expected: 'string',
				received: 'undefined',
				path: [],
				message: 'Environment variable "API_KEY": Required',
			}),
		]);

		const formatted = formatParseError(error, { colors: false });

		expect(formatted).toContain('API_KEY');
	});

	it('should handle colors option false', () => {
		const error = new z.ZodError([
			createIssue({
				code: 'invalid_type',
				expected: 'string',
				received: 'undefined',
				path: ['TEST'],
				message: 'Required',
			}),
		]);

		const formatted = formatParseError(error, { colors: false });

		// Should not contain ANSI codes
		expect(formatted).not.toContain('\x1b[');
	});

	it('should handle colors option true', () => {
		const error = new z.ZodError([
			createIssue({
				code: 'invalid_type',
				expected: 'string',
				received: 'undefined',
				path: ['TEST'],
				message: 'Required',
			}),
		]);

		const formatted = formatParseError(error, { colors: true });

		// Should contain ANSI codes
		expect(formatted).toContain('\x1b[');
	});
});

describe('isDevelopment', () => {
	const originalEnv = process.env.NODE_ENV;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = originalEnv;
		}
	});

	it('should return true when NODE_ENV is undefined', () => {
		delete process.env.NODE_ENV;
		expect(isDevelopment()).toBe(true);
	});

	it('should return true when NODE_ENV is development', () => {
		process.env.NODE_ENV = 'development';
		expect(isDevelopment()).toBe(true);
	});

	it('should return true when NODE_ENV is dev', () => {
		process.env.NODE_ENV = 'dev';
		expect(isDevelopment()).toBe(true);
	});

	it('should return true when NODE_ENV is DEVELOPMENT (case insensitive)', () => {
		process.env.NODE_ENV = 'DEVELOPMENT';
		expect(isDevelopment()).toBe(true);
	});

	it('should return false when NODE_ENV is production', () => {
		process.env.NODE_ENV = 'production';
		expect(isDevelopment()).toBe(false);
	});

	it('should return false when NODE_ENV is staging', () => {
		process.env.NODE_ENV = 'staging';
		expect(isDevelopment()).toBe(false);
	});

	it('should return false when NODE_ENV is test', () => {
		process.env.NODE_ENV = 'test';
		expect(isDevelopment()).toBe(false);
	});
});

describe('ConfigParser with dev formatting', () => {
	const originalEnv = process.env.NODE_ENV;

	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = originalEnv;
		}
	});

	it('should log formatted error in development mode', async () => {
		process.env.NODE_ENV = 'development';

		const { EnvironmentParser } = await import('../EnvironmentParser');
		const parser = new EnvironmentParser({});
		const config = parser.create((get) => ({
			dbUrl: get('DATABASE_URL').string(),
		}));

		expect(() => config.parse()).toThrow();
		expect(console.error).toHaveBeenCalled();

		const errorOutput = (console.error as any).mock.calls[0][0];
		expect(errorOutput).toContain('Environment Configuration Failed');
	});

	it('should not log formatted error in production mode', async () => {
		process.env.NODE_ENV = 'production';

		// Need to reimport to pick up the new NODE_ENV
		vi.resetModules();
		const { EnvironmentParser } = await import('../EnvironmentParser');

		const parser = new EnvironmentParser({});
		const config = parser.create((get) => ({
			dbUrl: get('DATABASE_URL').string(),
		}));

		expect(() => config.parse()).toThrow();
		expect(console.error).not.toHaveBeenCalled();
	});
});
