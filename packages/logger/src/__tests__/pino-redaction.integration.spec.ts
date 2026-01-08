import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REDACT_PATHS } from '../pino';
import type { RedactOptions } from '../types';

/**
 * Type for the resolved pino redact config.
 */
type PinoRedactConfig =
	| string[]
	| {
			paths: string[];
			censor?: string | ((value: unknown, path: string[]) => unknown);
			remove?: boolean;
	  };

/**
 * Resolves redact options to pino-compatible config, applying merge logic.
 */
function resolveRedactConfig(
	redact: RedactOptions | undefined,
): PinoRedactConfig | undefined {
	if (redact === undefined) {
		return undefined;
	}

	// Array syntax - merge with defaults
	if (Array.isArray(redact)) {
		return [...DEFAULT_REDACT_PATHS, ...redact];
	}

	// Object syntax - check resolution mode
	const { resolution = 'merge', paths, censor, remove } = redact;

	const resolvedPaths =
		resolution === 'override' ? paths : [...DEFAULT_REDACT_PATHS, ...paths];

	const config: PinoRedactConfig = { paths: resolvedPaths };
	if (censor !== undefined) config.censor = censor;
	if (remove !== undefined) config.remove = remove;

	return config;
}

/**
 * Creates a writable stream that captures pino output as parsed JSON objects.
 */
function createCaptureStream() {
	const logs: Record<string, unknown>[] = [];

	const stream = new Writable({
		write(chunk, _encoding, callback) {
			try {
				const line = chunk.toString().trim();
				if (line) {
					logs.push(JSON.parse(line));
				}
			} catch {
				// Ignore non-JSON lines (e.g., pretty output)
			}
			callback();
		},
	});

	return { stream, logs };
}

/**
 * Creates a logger that writes to a capture stream for testing.
 * Note: We can't use pretty mode here as it's not JSON parseable.
 */
function createTestLogger(redact: RedactOptions | undefined) {
	const { stream, logs } = createCaptureStream();

	// Import pino directly to create with custom destination
	const { pino } = require('pino');

	// Apply our merge logic before passing to pino
	const resolvedRedact = resolveRedactConfig(redact);

	const logger = pino(
		{
			redact: resolvedRedact,
			// Disable pretty for JSON parsing
			formatters: {
				level: (label: string) => ({ level: label }),
			},
		},
		stream,
	);

	return { logger, logs };
}

describe('Pino Redaction Integration', () => {
	describe('with redact: true (default paths)', () => {
		it('should redact password field', () => {
			const { logger, logs } = createTestLogger(DEFAULT_REDACT_PATHS);

			logger.info({ password: 'secret123', username: 'john' }, 'Login attempt');
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].password).toBe('[Redacted]');
			expect(logs[0].username).toBe('john');
		});

		it('should redact token field', () => {
			const { logger, logs } = createTestLogger(DEFAULT_REDACT_PATHS);

			logger.info({ token: 'jwt.token.here', userId: 123 }, 'Auth check');
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].token).toBe('[Redacted]');
			expect(logs[0].userId).toBe(123);
		});

		it('should redact apiKey field', () => {
			const { logger, logs } = createTestLogger(DEFAULT_REDACT_PATHS);

			logger.info({ apiKey: 'sk-1234567890', service: 'openai' }, 'API call');
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].apiKey).toBe('[Redacted]');
			expect(logs[0].service).toBe('openai');
		});

		it('should redact nested sensitive fields with wildcards', () => {
			const { logger, logs } = createTestLogger(DEFAULT_REDACT_PATHS);

			logger.info(
				{
					user: { password: 'secret', name: 'John' },
					config: { secret: 'shh', debug: true },
				},
				'Nested data',
			);
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].user).toEqual({ password: '[Redacted]', name: 'John' });
			expect(logs[0].config).toEqual({ secret: '[Redacted]', debug: true });
		});

		it('should redact authorization headers', () => {
			const { logger, logs } = createTestLogger(DEFAULT_REDACT_PATHS);

			logger.info(
				{
					headers: {
						authorization: 'Bearer xyz123',
						'content-type': 'application/json',
					},
				},
				'Request headers',
			);
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].headers).toEqual({
				authorization: '[Redacted]',
				'content-type': 'application/json',
			});
		});

		it('should redact credit card fields', () => {
			const { logger, logs } = createTestLogger(DEFAULT_REDACT_PATHS);

			logger.info(
				{
					creditCard: '4111-1111-1111-1111',
					cvv: '123',
					cardHolder: 'John Doe',
				},
				'Payment info',
			);
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].creditCard).toBe('[Redacted]');
			expect(logs[0].cvv).toBe('[Redacted]');
			expect(logs[0].cardHolder).toBe('John Doe');
		});
	});

	describe('with custom paths (merge mode - default)', () => {
		it('should merge custom paths with defaults', () => {
			const { logger, logs } = createTestLogger(['customSecret', 'data.key']);

			logger.info(
				{
					customSecret: 'hidden',
					password: 'also-hidden-from-defaults',
					data: { key: 'hidden', value: 'visible' },
				},
				'Merged redaction',
			);
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].customSecret).toBe('[Redacted]');
			// password is redacted because it's in DEFAULT_REDACT_PATHS
			expect(logs[0].password).toBe('[Redacted]');
			expect(logs[0].data).toEqual({ key: '[Redacted]', value: 'visible' });
		});

		it('should support wildcard paths merged with defaults', () => {
			const { logger, logs } = createTestLogger(['items[*].customField']);

			logger.info(
				{
					password: 'hidden-by-default',
					items: [
						{ id: 1, customField: 'a' },
						{ id: 2, customField: 'b' },
					],
				},
				'Array redaction',
			);
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].password).toBe('[Redacted]');
			expect(logs[0].items).toEqual([
				{ id: 1, customField: '[Redacted]' },
				{ id: 2, customField: '[Redacted]' },
			]);
		});
	});

	describe('with resolution: override', () => {
		it('should redact only specified paths when override', () => {
			const { logger, logs } = createTestLogger({
				paths: ['customSecret', 'data.key'],
				resolution: 'override',
			});

			logger.info(
				{
					customSecret: 'hidden',
					password: 'visible-because-override',
					data: { key: 'hidden', value: 'visible' },
				},
				'Override redaction',
			);
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].customSecret).toBe('[Redacted]');
			// password is NOT redacted because we're overriding defaults
			expect(logs[0].password).toBe('visible-because-override');
			expect(logs[0].data).toEqual({ key: '[Redacted]', value: 'visible' });
		});
	});

	describe('with object config', () => {
		it('should use custom censor string', () => {
			const { logger, logs } = createTestLogger({
				paths: ['password'],
				censor: '***HIDDEN***',
			});

			logger.info({ password: 'secret', user: 'john' }, 'Custom censor');
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].password).toBe('***HIDDEN***');
			expect(logs[0].user).toBe('john');
		});

		it('should remove field when remove: true', () => {
			const { logger, logs } = createTestLogger({
				paths: ['password', 'secret'],
				remove: true,
			});

			logger.info(
				{ password: 'secret', secret: 'shh', username: 'john' },
				'Remove mode',
			);
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0]).not.toHaveProperty('password');
			expect(logs[0]).not.toHaveProperty('secret');
			expect(logs[0].username).toBe('john');
		});
	});

	describe('without redaction', () => {
		it('should not redact when redact is undefined', () => {
			const { logger, logs } = createTestLogger(undefined);

			logger.info(
				{ password: 'visible', token: 'also-visible' },
				'No redaction',
			);
			logger.flush?.();

			expect(logs).toHaveLength(1);
			expect(logs[0].password).toBe('visible');
			expect(logs[0].token).toBe('also-visible');
		});
	});
});
