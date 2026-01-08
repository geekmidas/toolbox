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
import { DataBrowser } from '../../data/DataBrowser';
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

// Minimal Studio-like object for testing the Hono adapter
interface MockStudio {
	data: DataBrowser<TestDatabase>;
}

describe('Hono Server Adapter Integration Tests', () => {
	let db: Kysely<TestDatabase>;
	let mockStudio: MockStudio;
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
		// Create DataBrowser directly for testing
		const dataBrowser = new DataBrowser({
			db,
			cursor: { field: 'id', direction: Direction.Asc },
			tableCursors: {},
			excludeTables: [],
			defaultPageSize: 50,
			showBinaryColumns: false,
		});

		mockStudio = { data: dataBrowser };
		app = createStudioApp(mockStudio as any);

		// Insert test data
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
	});

	afterEach(async () => {
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
});
