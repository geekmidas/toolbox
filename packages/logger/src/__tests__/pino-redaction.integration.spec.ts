import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../pino';
import type { RedactOptions } from '../types';

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
 * The real `createLogger`, writing to a capture stream so its output can be
 * read back. Pretty mode is not JSON, so it is never used here.
 */
function createTestLogger(redact?: boolean | RedactOptions) {
	const { stream, logs } = createCaptureStream();

	const logger = createLogger({
		...(redact !== undefined && { redact }),
		destination: stream,
	});

	return { logger, logs };
}

describe('Pino Redaction Integration', () => {
	describe('with redact: true (default paths)', () => {
		it('should redact password field', () => {
			const { logger, logs } = createTestLogger(true);

			logger.info({ password: 'secret123', username: 'john' }, 'Login attempt');

			expect(logs).toHaveLength(1);
			expect(logs[0].password).toBe('[Redacted]');
			expect(logs[0].username).toBe('john');
		});

		it('should redact token field', () => {
			const { logger, logs } = createTestLogger(true);

			logger.info({ token: 'jwt.token.here', userId: 123 }, 'Auth check');

			expect(logs).toHaveLength(1);
			expect(logs[0].token).toBe('[Redacted]');
			expect(logs[0].userId).toBe(123);
		});

		it('should redact apiKey field', () => {
			const { logger, logs } = createTestLogger(true);

			logger.info({ apiKey: 'sk-1234567890', service: 'openai' }, 'API call');

			expect(logs).toHaveLength(1);
			expect(logs[0].apiKey).toBe('[Redacted]');
			expect(logs[0].service).toBe('openai');
		});

		it('should redact nested sensitive fields with wildcards', () => {
			const { logger, logs } = createTestLogger(true);

			logger.info(
				{
					user: { password: 'secret', name: 'John' },
					config: { secret: 'shh', debug: true },
				},
				'Nested data',
			);

			expect(logs).toHaveLength(1);
			expect(logs[0].user).toEqual({ password: '[Redacted]', name: 'John' });
			expect(logs[0].config).toEqual({ secret: '[Redacted]', debug: true });
		});

		it('should redact authorization headers', () => {
			const { logger, logs } = createTestLogger(true);

			logger.info(
				{
					headers: {
						authorization: 'Bearer xyz123',
						'content-type': 'application/json',
					},
				},
				'Request headers',
			);

			expect(logs).toHaveLength(1);
			expect(logs[0].headers).toEqual({
				authorization: '[Redacted]',
				'content-type': 'application/json',
			});
		});

		it('should redact credit card fields', () => {
			const { logger, logs } = createTestLogger(true);

			logger.info(
				{
					creditCard: '4111-1111-1111-1111',
					cvv: '123',
					cardHolder: 'John Doe',
				},
				'Payment info',
			);

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

			expect(logs).toHaveLength(1);
			expect(logs[0]).not.toHaveProperty('password');
			expect(logs[0]).not.toHaveProperty('secret');
			expect(logs[0].username).toBe('john');
		});
	});

	describe('by default', () => {
		it('should redact sensitive fields when redact is not set', () => {
			const { logger, logs } = createTestLogger();

			logger.info(
				{
					password: 'secret123',
					token: 'jwt.token.here',
					headers: { authorization: 'Bearer xyz123' },
					username: 'john',
				},
				'Login attempt',
			);

			expect(logs).toHaveLength(1);
			expect(logs[0].password).toBe('[Redacted]');
			expect(logs[0].token).toBe('[Redacted]');
			expect(logs[0].headers).toEqual({ authorization: '[Redacted]' });
			expect(logs[0].username).toBe('john');
		});

		it('should redact every default path when redact is not set', () => {
			const { logger, logs } = createTestLogger();

			logger.info(
				{ apiKey: 'sk-1234567890', creditCard: '4111-1111-1111-1111' },
				'Defaults',
			);

			expect(logs[0].apiKey).toBe('[Redacted]');
			expect(logs[0].creditCard).toBe('[Redacted]');
		});
	});

	describe('URL credentials', () => {
		const url = 's3://AKIAEXAMPLE:wJal%2FrXUt%2BnFEMI@uploads?region=eu-west-1';

		it('masks the userinfo of a URL in any field, at any depth', () => {
			const { logger, logs } = createTestLogger();

			logger.info(
				{ url, bucket: { origin: url }, urls: [url], name: 'uploads' },
				'Connecting',
			);

			const line = JSON.stringify(logs[0]);
			expect(line).not.toContain('wJal');
			expect(line).not.toContain('AKIAEXAMPLE');
			expect(logs[0].url).toBe('s3://REDACTED@uploads?region=eu-west-1');
			expect(logs[0].urls).toEqual(['s3://REDACTED@uploads?region=eu-west-1']);
			expect(logs[0].name).toBe('uploads');
		});

		it('masks the userinfo of a URL in the message', () => {
			const { logger, logs } = createTestLogger();

			logger.info(`Connecting to ${url}`);

			expect(logs[0].msg).toBe(
				'Connecting to s3://REDACTED@uploads?region=eu-west-1',
			);
		});

		it('still blanks a connection string by path', () => {
			const { logger, logs } = createTestLogger();

			logger.info({ connectionString: url });

			expect(logs[0].connectionString).toBe('[Redacted]');
		});

		it('leaves a URL without a password alone', () => {
			const { logger, logs } = createTestLogger();

			logger.info({ url: 'ssh://git@github.com/x.git' });

			expect(logs[0].url).toBe('ssh://git@github.com/x.git');
		});

		it('is off with redaction', () => {
			const { logger, logs } = createTestLogger(false);

			logger.info({ url });

			expect(logs[0].url).toBe(url);
		});
	});

	describe('without redaction', () => {
		it('should not redact when redact is false', () => {
			const { logger, logs } = createTestLogger(false);

			logger.info(
				{ password: 'visible', token: 'also-visible' },
				'No redaction',
			);

			expect(logs).toHaveLength(1);
			expect(logs[0].password).toBe('visible');
			expect(logs[0].token).toBe('also-visible');
		});
	});
});
