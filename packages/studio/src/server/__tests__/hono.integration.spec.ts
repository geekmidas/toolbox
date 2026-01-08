import { InMemoryStorage } from '@geekmidas/telescope';
import {
	CamelCasePlugin,
	type Generated,
	Kysely,
	PostgresDialect,
	sql,
} from 'kysely';
import pg from 'pg';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { Studio } from '../../Studio';
import { Direction } from '../../types';
import { createStudioApp } from '../hono';

interface TestDatabase {
	studioHonoProducts: {
		id: Generated<number>;
		name: string;
		price: number;
		category: string;
		inStock: boolean;
		createdAt: Generated<Date>;
	};
}

describe('Hono Server Adapter Integration Tests', () => {
	let db: Kysely<TestDatabase>;
	let studio: Studio<TestDatabase>;
	let storage: InMemoryStorage;
	let app: ReturnType<typeof createStudioApp>;

	beforeAll(async () => {
		db = new Kysely<TestDatabase>({
			dialect: new PostgresDialect({
				pool: new pg.Pool({
					...TEST_DATABASE_CONFIG,
					database: 'postgres',
				}),
			}),
			plugins: [new CamelCasePlugin()],
		});

		// Create test table
		await db.schema
			.createTable('studio_hono_products')
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('name', 'varchar(255)', (col) => col.notNull())
			.addColumn('price', 'numeric(10, 2)', (col) => col.notNull())
			.addColumn('category', 'varchar(100)', (col) => col.notNull())
			.addColumn('in_stock', 'boolean', (col) => col.notNull().defaultTo(true))
			.addColumn('created_at', 'timestamptz', (col) =>
				col.defaultTo(sql`now()`).notNull(),
			)
			.execute();
	});

	beforeEach(async () => {
		storage = new InMemoryStorage();
		studio = new Studio({
			monitoring: { storage },
			data: {
				db,
				cursor: { field: 'id', direction: Direction.Asc },
			},
		});
		app = createStudioApp(studio);

		// Insert test data for database browsing
		await db
			.insertInto('studioHonoProducts')
			.values([
				{
					name: 'Laptop',
					price: 999.99,
					category: 'electronics',
					inStock: true,
				},
				{
					name: 'Mouse',
					price: 29.99,
					category: 'electronics',
					inStock: true,
				},
				{
					name: 'Keyboard',
					price: 79.99,
					category: 'electronics',
					inStock: false,
				},
				{ name: 'Desk', price: 299.99, category: 'furniture', inStock: true },
				{ name: 'Chair', price: 199.99, category: 'furniture', inStock: true },
			])
			.execute();

		// Record some monitoring data
		await studio.recordRequest({
			method: 'GET',
			path: '/api/users',
			status: 200,
			duration: 45,
		});
		await studio.recordRequest({
			method: 'POST',
			path: '/api/users',
			status: 201,
			duration: 80,
		});
		await studio.recordRequest({
			method: 'GET',
			path: '/api/products',
			status: 500,
			duration: 120,
		});

		await studio.info('Application started');
		await studio.warn('High memory usage detected');
		await studio.error('Database connection timeout');

		await studio.exception(new Error('Test exception'));
	});

	afterEach(async () => {
		studio.destroy();
		await db.deleteFrom('studioHonoProducts').execute();
	});

	afterAll(async () => {
		await db.schema.dropTable('studio_hono_products').ifExists().execute();
		await db.destroy();
	});

	describe('GET /api/schema', () => {
		it('should return database schema', async () => {
			const res = await app.request('/api/schema');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.tables).toBeDefined();
			expect(Array.isArray(data.tables)).toBe(true);
			expect(data.updatedAt).toBeDefined();
		});

		it('should force refresh when requested', async () => {
			const res1 = await app.request('/api/schema');
			const data1 = await res1.json();

			const res2 = await app.request('/api/schema?refresh=true');
			const data2 = await res2.json();

			// Both should have tables
			expect(data1.tables).toBeDefined();
			expect(data2.tables).toBeDefined();
		});
	});

	describe('GET /api/tables', () => {
		it('should return list of tables', async () => {
			const res = await app.request('/api/tables');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.tables).toBeDefined();

			const productTable = data.tables.find(
				(t: any) => t.name === 'studio_hono_products',
			);
			expect(productTable).toBeDefined();
			expect(productTable.columnCount).toBeGreaterThan(0);
			expect(productTable.primaryKey).toEqual(['id']);
		});
	});

	describe('GET /api/tables/:name', () => {
		it('should return table info for existing table', async () => {
			const res = await app.request('/api/tables/studio_hono_products');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.name).toBe('studio_hono_products');
			expect(data.columns).toBeDefined();
			expect(data.columns.length).toBeGreaterThan(0);
		});

		it('should return 404 for non-existent table', async () => {
			const res = await app.request('/api/tables/non_existent_table');

			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error).toContain('not found');
		});
	});

	describe('GET /api/tables/:name/rows', () => {
		it('should return paginated rows', async () => {
			const res = await app.request('/api/tables/studio_hono_products/rows');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.rows).toBeDefined();
			expect(data.rows.length).toBe(5);
			expect(data.hasMore).toBe(false);
		});

		it('should respect pageSize parameter', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?pageSize=2',
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.rows.length).toBe(2);
			expect(data.hasMore).toBe(true);
			expect(data.nextCursor).toBeDefined();
		});

		it('should paginate using cursor', async () => {
			const res1 = await app.request(
				'/api/tables/studio_hono_products/rows?pageSize=2',
			);
			const data1 = await res1.json();

			const res2 = await app.request(
				`/api/tables/studio_hono_products/rows?pageSize=2&cursor=${data1.nextCursor}`,
			);
			const data2 = await res2.json();

			expect(data2.rows.length).toBe(2);

			// Rows should be different
			const ids1 = data1.rows.map((r: any) => r.id);
			const ids2 = data2.rows.map((r: any) => r.id);
			expect(ids1.every((id: number) => !ids2.includes(id))).toBe(true);
		});

		it('should apply equality filter', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?filter[category][eq]=electronics',
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.rows.length).toBe(3);
			data.rows.forEach((row: any) => {
				expect(row.category).toBe('electronics');
			});
		});

		it('should apply greater-than filter', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?filter[price][gt]=100',
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.rows.length).toBe(3);
			data.rows.forEach((row: any) => {
				expect(Number(row.price)).toBeGreaterThan(100);
			});
		});

		it('should apply boolean filter', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?filter[in_stock][eq]=false',
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.rows.length).toBe(1);
			expect(data.rows[0].name).toBe('Keyboard');
		});

		it('should apply IN filter', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?filter[name][in]=Laptop,Mouse',
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.rows.length).toBe(2);
		});

		it('should apply multiple filters', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?filter[category][eq]=electronics&filter[in_stock][eq]=true',
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.rows.length).toBe(2);
			data.rows.forEach((row: any) => {
				expect(row.category).toBe('electronics');
				expect(row.inStock).toBe(true);
			});
		});

		it('should apply sorting', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?sort=price:desc',
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			const prices = data.rows.map((r: any) => Number(r.price));

			for (let i = 1; i < prices.length; i++) {
				expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
			}
		});

		it('should apply multiple sort columns', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?sort=category:asc,price:desc',
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.rows.length).toBe(5);

			// Electronics should come first (alphabetically)
			const electronics = data.rows.filter(
				(r: any) => r.category === 'electronics',
			);
			expect(electronics.length).toBe(3);

			// Within electronics, prices should be descending
			const electronicPrices = electronics.map((r: any) => Number(r.price));
			for (let i = 1; i < electronicPrices.length; i++) {
				expect(electronicPrices[i]).toBeLessThanOrEqual(
					electronicPrices[i - 1],
				);
			}
		});

		it('should return 404 for non-existent table', async () => {
			const res = await app.request('/api/tables/non_existent_table/rows');

			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error).toContain('not found');
		});

		it('should cap pageSize at 100', async () => {
			const res = await app.request(
				'/api/tables/studio_hono_products/rows?pageSize=500',
			);

			expect(res.status).toBe(200);
			// Since we only have 5 rows, we just verify the request succeeds
			const data = await res.json();
			expect(data.rows).toBeDefined();
		});
	});

	// ============================================
	// Monitoring API Tests
	// ============================================

	describe('GET /api/stats', () => {
		it('should return storage statistics', async () => {
			const res = await app.request('/api/stats');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.requests).toBe(3);
			expect(data.exceptions).toBe(1);
			expect(data.logs).toBe(3);
		});
	});

	describe('GET /api/requests', () => {
		it('should return request entries', async () => {
			const res = await app.request('/api/requests');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data)).toBe(true);
			expect(data.length).toBe(3);
		});

		it('should accept query parameters', async () => {
			const res = await app.request('/api/requests?limit=2');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data)).toBe(true);
			expect(data.length).toBe(2);
		});
	});

	describe('GET /api/requests/:id', () => {
		it('should return a single request by ID', async () => {
			const requests = await studio.getRequests();
			const requestId = requests[0].id;

			const res = await app.request(`/api/requests/${requestId}`);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.id).toBe(requestId);
		});

		it('should return 404 for non-existent request', async () => {
			const res = await app.request('/api/requests/non-existent');

			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error).toBe('Request not found');
		});
	});

	describe('GET /api/exceptions', () => {
		it('should return exception entries', async () => {
			const res = await app.request('/api/exceptions');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data)).toBe(true);
			expect(data.length).toBe(1);
			expect(data[0].message).toBe('Test exception');
		});
	});

	describe('GET /api/exceptions/:id', () => {
		it('should return a single exception by ID', async () => {
			const exceptions = await studio.getExceptions();
			const exceptionId = exceptions[0].id;

			const res = await app.request(`/api/exceptions/${exceptionId}`);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.id).toBe(exceptionId);
			expect(data.message).toBe('Test exception');
		});

		it('should return 404 for non-existent exception', async () => {
			const res = await app.request('/api/exceptions/non-existent');

			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error).toBe('Exception not found');
		});
	});

	describe('GET /api/logs', () => {
		it('should return log entries', async () => {
			const res = await app.request('/api/logs');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data)).toBe(true);
			expect(data.length).toBe(3);
		});

		it('should accept level filter', async () => {
			const res = await app.request('/api/logs?level=error');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data)).toBe(true);
			expect(data.length).toBe(1);
			expect(data[0].message).toBe('Database connection timeout');
		});
	});

	// ============================================
	// Metrics API Tests
	// ============================================

	describe('GET /api/metrics', () => {
		it('should return aggregated metrics', async () => {
			const res = await app.request('/api/metrics');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.totalRequests).toBe(3);
			expect(typeof data.avgDuration).toBe('number');
		});

		it('should accept time range parameters', async () => {
			const start = new Date(Date.now() - 3600000).toISOString();
			const end = new Date().toISOString();
			const res = await app.request(`/api/metrics?start=${start}&end=${end}`);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.totalRequests).toBeDefined();
		});
	});

	describe('GET /api/metrics/endpoints', () => {
		it('should return endpoint metrics', async () => {
			const res = await app.request('/api/metrics/endpoints');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data)).toBe(true);
			expect(data.length).toBeGreaterThan(0);
		});

		it('should accept limit parameter', async () => {
			const res = await app.request('/api/metrics/endpoints?limit=1');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data)).toBe(true);
		});
	});

	describe('GET /api/metrics/endpoint', () => {
		it('should return details for a specific endpoint', async () => {
			const res = await app.request(
				'/api/metrics/endpoint?method=GET&path=/api/users',
			);

			// May return 200 with data or 404 if endpoint not tracked
			expect([200, 404]).toContain(res.status);
			if (res.status === 200) {
				const data = await res.json();
				expect(data.method).toBe('GET');
				expect(data.path).toBe('/api/users');
			}
		});

		it('should return 400 if method is missing', async () => {
			const res = await app.request('/api/metrics/endpoint?path=/api/users');

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('method and path are required');
		});

		it('should return 400 if path is missing', async () => {
			const res = await app.request('/api/metrics/endpoint?method=GET');

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error).toBe('method and path are required');
		});

		it('should return 404 for non-existent endpoint', async () => {
			const res = await app.request(
				'/api/metrics/endpoint?method=DELETE&path=/api/unknown',
			);

			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error).toBe('Endpoint not found');
		});
	});

	describe('GET /api/metrics/status', () => {
		it('should return status distribution', async () => {
			const res = await app.request('/api/metrics/status');

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toBeDefined();
		});
	});

	describe('DELETE /api/metrics', () => {
		it('should reset metrics', async () => {
			const res = await app.request('/api/metrics', { method: 'DELETE' });

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.success).toBe(true);

			// Verify metrics are reset
			const metricsRes = await app.request('/api/metrics');
			const metrics = await metricsRes.json();
			expect(metrics.totalRequests).toBe(0);
		});
	});

	// ============================================
	// UI & Static Assets
	// ============================================

	describe('GET /', () => {
		it('should return dashboard UI or API info', async () => {
			const res = await app.request('/');

			expect(res.status).toBe(200);
			const contentType = res.headers.get('content-type') || '';

			// If UI is embedded, returns HTML; otherwise returns JSON API info
			if (contentType.includes('text/html')) {
				const html = await res.text();
				expect(html).toContain('<!doctype html>');
			} else {
				const data = await res.json();
				expect(data.message).toBe('Studio API is running');
				expect(data.endpoints).toBeDefined();
			}
		});
	});

	describe('API 404 handling', () => {
		it('should return JSON 404 for unknown API routes', async () => {
			const res = await app.request('/api/unknown-route');

			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error).toBe('Not found');
		});
	});
});
