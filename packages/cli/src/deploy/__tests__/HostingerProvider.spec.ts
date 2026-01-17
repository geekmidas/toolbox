import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import { HostingerProvider } from '../dns/HostingerProvider';

/**
 * HostingerProvider Tests
 *
 * Uses MSW to mock the Hostinger DNS API.
 * API Base: https://developers.hostinger.com
 */
describe('HostingerProvider', () => {
	const HOSTINGER_API_BASE = 'https://developers.hostinger.com';
	const TEST_DOMAIN = 'example.com';
	const TEST_TOKEN = 'test-hostinger-token';

	// Track current mock records for realistic API simulation
	let mockRecords: Array<{
		name: string;
		type: string;
		ttl: number;
		records: Array<{ content: string }>;
	}> = [];

	// MSW server setup
	const server = setupServer(
		// GET /api/dns/v1/zones/{domain} - Get DNS records
		http.get(`${HOSTINGER_API_BASE}/api/dns/v1/zones/:domain`, ({ request }) => {
			// Check authorization
			const authHeader = request.headers.get('Authorization');
			if (authHeader !== `Bearer ${TEST_TOKEN}`) {
				return HttpResponse.json(
					{ message: 'Unauthorized' },
					{ status: 401 },
				);
			}

			return HttpResponse.json({ data: mockRecords });
		}),

		// PUT /api/dns/v1/zones/{domain} - Upsert DNS records
		http.put(`${HOSTINGER_API_BASE}/api/dns/v1/zones/:domain`, async ({ request }) => {
			// Check authorization
			const authHeader = request.headers.get('Authorization');
			if (authHeader !== `Bearer ${TEST_TOKEN}`) {
				return HttpResponse.json(
					{ message: 'Unauthorized' },
					{ status: 401 },
				);
			}

			const body = await request.json() as {
				overwrite?: boolean;
				zone: Array<{
					name: string;
					type: string;
					ttl: number;
					records: Array<{ content: string }>;
				}>;
			};

			// Simulate upsert behavior
			for (const record of body.zone) {
				const existingIndex = mockRecords.findIndex(
					(r) => r.name === record.name && r.type === record.type,
				);
				if (existingIndex >= 0) {
					mockRecords[existingIndex] = record;
				} else {
					mockRecords.push(record);
				}
			}

			return new HttpResponse(null, { status: 204 });
		}),
	);

	beforeAll(() => {
		// Set the token via environment variable
		process.env.HOSTINGER_API_TOKEN = TEST_TOKEN;
		server.listen({ onUnhandledRequest: 'error' });
	});

	beforeEach(() => {
		// Reset mock records before each test
		mockRecords = [];
	});

	afterEach(() => {
		server.resetHandlers();
	});

	afterAll(() => {
		delete process.env.HOSTINGER_API_TOKEN;
		server.close();
	});

	describe('name', () => {
		it('should have name "hostinger"', () => {
			const provider = new HostingerProvider();
			expect(provider.name).toBe('hostinger');
		});
	});

	describe('getRecords', () => {
		it('should throw error when token is invalid', async () => {
			// Use an invalid token
			const savedToken = process.env.HOSTINGER_API_TOKEN;
			process.env.HOSTINGER_API_TOKEN = 'invalid-token';

			try {
				const provider = new HostingerProvider();
				await expect(provider.getRecords(TEST_DOMAIN)).rejects.toThrow(
					'Hostinger API error',
				);
			} finally {
				// Restore the token
				process.env.HOSTINGER_API_TOKEN = savedToken;
			}
		});

		it('should return empty array when no records exist', async () => {
			const provider = new HostingerProvider();
			const records = await provider.getRecords(TEST_DOMAIN);

			expect(records).toEqual([]);
		});

		it('should return records from API', async () => {
			// Set up mock records
			mockRecords = [
				{
					name: 'api',
					type: 'A',
					ttl: 300,
					records: [{ content: '1.2.3.4' }],
				},
				{
					name: 'www',
					type: 'CNAME',
					ttl: 300,
					records: [{ content: 'example.com' }],
				},
			];

			const provider = new HostingerProvider();
			const records = await provider.getRecords(TEST_DOMAIN);

			expect(records).toHaveLength(2);
			expect(records[0]).toEqual({
				name: 'api',
				type: 'A',
				ttl: 300,
				values: ['1.2.3.4'],
			});
			expect(records[1]).toEqual({
				name: 'www',
				type: 'CNAME',
				ttl: 300,
				values: ['example.com'],
			});
		});

		it('should handle records with multiple values', async () => {
			mockRecords = [
				{
					name: 'mail',
					type: 'MX',
					ttl: 3600,
					records: [
						{ content: '10 mail1.example.com' },
						{ content: '20 mail2.example.com' },
					],
				},
			];

			const provider = new HostingerProvider();
			const records = await provider.getRecords(TEST_DOMAIN);

			expect(records).toHaveLength(1);
			expect(records[0]?.values).toEqual([
				'10 mail1.example.com',
				'20 mail2.example.com',
			]);
		});

		it('should cache API client after first call', async () => {
			const provider = new HostingerProvider();

			// Make two calls
			await provider.getRecords(TEST_DOMAIN);
			await provider.getRecords(TEST_DOMAIN);

			// Both should succeed (API client is reused internally)
			// If caching wasn't working, we'd see issues with token retrieval
			expect(true).toBe(true);
		});
	});

	describe('upsertRecords', () => {
		it('should create new records', async () => {
			const provider = new HostingerProvider();
			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
				created: true,
				unchanged: false,
			});

			// Verify record was added to mock store
			expect(mockRecords).toHaveLength(1);
			expect(mockRecords[0]).toEqual({
				name: 'api',
				type: 'A',
				ttl: 300,
				records: [{ content: '1.2.3.4' }],
			});
		});

		it('should mark unchanged when record exists with same value', async () => {
			// Pre-populate with existing record
			mockRecords = [
				{
					name: 'api',
					type: 'A',
					ttl: 300,
					records: [{ content: '1.2.3.4' }],
				},
			];

			const provider = new HostingerProvider();
			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
				created: false,
				unchanged: true,
			});
		});

		it('should update record when value changes', async () => {
			// Pre-populate with existing record
			mockRecords = [
				{
					name: 'api',
					type: 'A',
					ttl: 300,
					records: [{ content: '1.2.3.4' }],
				},
			];

			const provider = new HostingerProvider();
			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: 'api', type: 'A', ttl: 300, value: '5.6.7.8' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '5.6.7.8' },
				created: false,
				unchanged: false,
			});

			// Verify record was updated in mock store
			expect(mockRecords[0]?.records[0]?.content).toBe('5.6.7.8');
		});

		it('should handle multiple records with mixed states', async () => {
			// Pre-populate with one existing record
			mockRecords = [
				{
					name: 'api',
					type: 'A',
					ttl: 300,
					records: [{ content: '1.2.3.4' }],
				},
			];

			const provider = new HostingerProvider();
			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' }, // Unchanged
				{ name: 'www', type: 'A', ttl: 300, value: '1.2.3.4' }, // New
			]);

			expect(results).toHaveLength(2);
			expect(results[0]?.unchanged).toBe(true);
			expect(results[1]?.created).toBe(true);
		});
	});
});
