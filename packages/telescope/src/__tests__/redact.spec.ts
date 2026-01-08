import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRedactor, DEFAULT_REDACT_PATHS } from '../redact';
import { InMemoryStorage } from '../storage/memory';
import { Telescope } from '../Telescope';

describe('createRedactor', () => {
	it('should return undefined when options is undefined', () => {
		expect(createRedactor(undefined)).toBeUndefined();
	});

	it('should return undefined when options is false', () => {
		expect(createRedactor(false)).toBeUndefined();
	});

	it('should create redactor with default paths when options is true', () => {
		const redactor = createRedactor(true);
		expect(redactor).toBeDefined();

		const data = { headers: { authorization: 'Bearer secret' } };
		const result = redactor?.(data);
		expect(result.headers.authorization).toBe('[REDACTED]');
	});

	it('should merge custom paths with defaults when array is provided', () => {
		const redactor = createRedactor(['custom.secret']);
		expect(redactor).toBeDefined();

		// Should redact default paths
		const data1 = { headers: { authorization: 'Bearer token' } };
		expect(redactor?.(data1).headers.authorization).toBe('[REDACTED]');

		// Should redact custom paths
		const data2 = { custom: { secret: 'mysecret' } };
		expect(redactor?.(data2).custom.secret).toBe('[REDACTED]');
	});

	it('should use custom censor value', () => {
		const redactor = createRedactor({ paths: [], censor: '***' });
		expect(redactor).toBeDefined();

		const data = { headers: { authorization: 'Bearer token' } };
		const result = redactor?.(data);
		expect(result.headers.authorization).toBe('***');
	});

	it('should not modify unmatched paths', () => {
		const redactor = createRedactor(true);

		const data = {
			headers: { 'content-type': 'application/json' },
			body: { username: 'john', email: 'john@example.com' },
		};
		const result = redactor?.(data);

		expect(result.headers['content-type']).toBe('application/json');
		expect(result.body.username).toBe('john');
		expect(result.body.email).toBe('john@example.com');
	});
});

describe('DEFAULT_REDACT_PATHS', () => {
	it('should include common HTTP header paths', () => {
		expect(DEFAULT_REDACT_PATHS).toContain('headers.authorization');
		expect(DEFAULT_REDACT_PATHS).toContain('headers.cookie');
	});

	it('should include body sensitive field paths', () => {
		expect(DEFAULT_REDACT_PATHS).toContain('body.password');
		expect(DEFAULT_REDACT_PATHS).toContain('body.token');
		expect(DEFAULT_REDACT_PATHS).toContain('body.apiKey');
	});

	it('should include context paths for log redaction', () => {
		expect(DEFAULT_REDACT_PATHS).toContain('context.password');
		expect(DEFAULT_REDACT_PATHS).toContain('context.token');
	});
});

describe('Telescope with redaction', () => {
	let telescope: Telescope;
	let storage: InMemoryStorage;

	beforeEach(() => {
		storage = new InMemoryStorage();
	});

	afterEach(() => {
		telescope?.destroy();
	});

	describe('recordRequest', () => {
		it('should redact sensitive headers when redact is enabled', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.recordRequest({
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost/api/users',
				headers: {
					authorization: 'Bearer supersecrettoken',
					cookie: 'session=abc123',
					'content-type': 'application/json',
				},
				query: {},
				status: 200,
				responseHeaders: { 'content-type': 'application/json' },
				duration: 50,
			});

			const requests = await telescope.getRequests();
			expect(requests).toHaveLength(1);

			const req = requests[0];
			expect(req.headers.authorization).toBe('[REDACTED]');
			expect(req.headers.cookie).toBe('[REDACTED]');
			expect(req.headers['content-type']).toBe('application/json');
		});

		it('should redact sensitive body fields', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.recordRequest({
				method: 'POST',
				path: '/api/login',
				url: 'http://localhost/api/login',
				headers: {},
				query: {},
				body: {
					username: 'john',
					password: 'secret123',
					token: 'refresh-token-value',
				},
				status: 200,
				responseHeaders: {},
				responseBody: {
					accessToken: 'jwt-token',
					user: { id: '123', name: 'John' },
				},
				duration: 100,
			});

			const requests = await telescope.getRequests();
			const req = requests[0];

			expect(req.body).toEqual({
				username: 'john',
				password: '[REDACTED]',
				token: '[REDACTED]',
			});

			expect(req.responseBody).toEqual({
				accessToken: '[REDACTED]',
				user: { id: '123', name: 'John' },
			});
		});

		it('should redact query parameters', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.recordRequest({
				method: 'GET',
				path: '/api/data',
				url: 'http://localhost/api/data?token=secret&page=1',
				headers: {},
				query: {
					token: 'secret-token',
					api_key: 'my-api-key',
					page: '1',
				},
				status: 200,
				responseHeaders: {},
				duration: 50,
			});

			const requests = await telescope.getRequests();
			const req = requests[0];

			expect(req.query?.token).toBe('[REDACTED]');
			expect(req.query?.api_key).toBe('[REDACTED]');
			expect(req.query?.page).toBe('1');
		});

		it('should not redact when redact option is not set', async () => {
			telescope = new Telescope({ storage }); // No redact option

			await telescope.recordRequest({
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost/api/users',
				headers: { authorization: 'Bearer token' },
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 50,
			});

			const requests = await telescope.getRequests();
			expect(requests[0].headers.authorization).toBe('Bearer token');
		});

		it('should use custom censor value', async () => {
			telescope = new Telescope({
				storage,
				redact: { paths: [], censor: '***HIDDEN***' },
			});

			await telescope.recordRequest({
				method: 'GET',
				path: '/api/users',
				url: 'http://localhost/api/users',
				headers: { authorization: 'Bearer token' },
				query: {},
				status: 200,
				responseHeaders: {},
				duration: 50,
			});

			const requests = await telescope.getRequests();
			expect(requests[0].headers.authorization).toBe('***HIDDEN***');
		});
	});

	describe('logging', () => {
		it('should redact sensitive context in info()', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.info('User authenticated', {
				userId: '123',
				password: 'shouldnotshow',
				token: 'sensitive-token',
			});

			const logs = await telescope.getLogs();
			expect(logs).toHaveLength(1);

			const log = logs[0];
			expect(log.context?.userId).toBe('123');
			expect(log.context?.password).toBe('[REDACTED]');
			expect(log.context?.token).toBe('[REDACTED]');
		});

		it('should redact context in debug()', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.debug('Debug info', { secret: 'mysecret' });

			const logs = await telescope.getLogs();
			expect(logs[0].context?.secret).toBe('[REDACTED]');
		});

		it('should redact context in warn()', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.warn('Warning', { apiKey: 'key123' });

			const logs = await telescope.getLogs();
			expect(logs[0].context?.apiKey).toBe('[REDACTED]');
		});

		it('should redact context in error()', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.error('Error occurred', { password: 'pass' });

			const logs = await telescope.getLogs();
			expect(logs[0].context?.password).toBe('[REDACTED]');
		});

		it('should redact batch log entries', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.log([
				{ level: 'info', message: 'First', context: { token: 'abc' } },
				{ level: 'debug', message: 'Second', context: { password: 'xyz' } },
			]);

			const logs = await telescope.getLogs();
			expect(logs).toHaveLength(2);
			expect(logs.find((l) => l.message === 'First')?.context?.token).toBe(
				'[REDACTED]',
			);
			expect(logs.find((l) => l.message === 'Second')?.context?.password).toBe(
				'[REDACTED]',
			);
		});

		it('should not redact log message', async () => {
			telescope = new Telescope({ storage, redact: true });

			await telescope.info('Password changed for user');

			const logs = await telescope.getLogs();
			expect(logs[0].message).toBe('Password changed for user');
		});
	});

	describe('custom paths', () => {
		it('should redact custom paths merged with defaults', async () => {
			telescope = new Telescope({
				storage,
				redact: ['body.customSecret', 'context.privateData'],
			});

			await telescope.recordRequest({
				method: 'POST',
				path: '/api/data',
				url: 'http://localhost/api/data',
				headers: { authorization: 'Bearer token' },
				query: {},
				body: {
					customSecret: 'my-custom-secret',
					normalField: 'visible',
				},
				status: 200,
				responseHeaders: {},
				duration: 50,
			});

			await telescope.info('Log with custom field', {
				privateData: 'hidden',
				publicData: 'visible',
			});

			const requests = await telescope.getRequests();
			expect(requests[0].headers.authorization).toBe('[REDACTED]');
			expect(requests[0].body).toEqual({
				customSecret: '[REDACTED]',
				normalField: 'visible',
			});

			const logs = await telescope.getLogs();
			expect(logs[0].context?.privateData).toBe('[REDACTED]');
			expect(logs[0].context?.publicData).toBe('visible');
		});
	});
});
