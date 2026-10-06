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
import { Direction } from '../../pagination';
import { DataBrowser } from '../DataBrowser';
import { TableNotFound } from '../errors';
import { FilterOperator } from '../types';

interface TestDatabase {
	introspectBrowserProducts: {
		id: Generated<number>;
		name: string;
		price: number;
		category: string;
		inStock: boolean;
		createdAt: Generated<Date>;
	};
	introspectBrowserOrders: {
		id: Generated<number>;
		productId: number;
		quantity: number;
		total: number;
		createdAt: Generated<Date>;
	};
	introspectBrowserExcluded: {
		id: Generated<number>;
		value: string;
	};
}

describe('DataBrowser Integration Tests', () => {
	let db: Kysely<TestDatabase>;
	let browser: DataBrowser<TestDatabase>;

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

		// Create products table
		await db.schema
			.createTable('introspect_browser_products')
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

		// Create orders table with foreign key
		await db.schema
			.createTable('introspect_browser_orders')
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('product_id', 'integer', (col) =>
				col
					.notNull()
					.references('introspect_browser_products.id')
					.onDelete('cascade'),
			)
			.addColumn('quantity', 'integer', (col) => col.notNull())
			.addColumn('total', 'numeric(10, 2)', (col) => col.notNull())
			.addColumn('created_at', 'timestamptz', (col) =>
				col.defaultTo(sql`now()`).notNull(),
			)
			.execute();

		// Create excluded table
		await db.schema
			.createTable('introspect_browser_excluded')
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('value', 'varchar(100)', (col) => col.notNull())
			.execute();
	});

	beforeEach(async () => {
		// Create fresh browser instance for each test
		browser = new DataBrowser({
			db,
			cursor: { field: 'id', direction: Direction.Asc },
			tableCursors: {},
			excludeTables: ['introspect_browser_excluded'],
			defaultPageSize: 10,
		});

		// Insert test products
		await db
			.insertInto('introspectBrowserProducts')
			.values([
				{
					name: 'Product A',
					price: 100,
					category: 'electronics',
					inStock: true,
				},
				{
					name: 'Product B',
					price: 200,
					category: 'electronics',
					inStock: true,
				},
				{ name: 'Product C', price: 50, category: 'clothing', inStock: false },
				{ name: 'Product D', price: 150, category: 'clothing', inStock: true },
				{
					name: 'Product E',
					price: 300,
					category: 'electronics',
					inStock: true,
				},
			])
			.execute();
	});

	afterEach(async () => {
		await db.deleteFrom('introspectBrowserOrders').execute();
		await db.deleteFrom('introspectBrowserProducts').execute();
		await db.deleteFrom('introspectBrowserExcluded').execute();
	});

	afterAll(async () => {
		await db.schema.dropTable('introspect_browser_orders').ifExists().execute();
		await db.schema
			.dropTable('introspect_browser_products')
			.ifExists()
			.execute();
		await db.schema
			.dropTable('introspect_browser_excluded')
			.ifExists()
			.execute();
		await db.destroy();
	});

	describe('getSchema', () => {
		it('should return schema with tables', async () => {
			const schema = await browser.getSchema();

			const tableNames = schema.tables.map((t) => t.name);
			expect(tableNames).toContain('introspect_browser_products');
			expect(tableNames).toContain('introspect_browser_orders');
			expect(tableNames).not.toContain('introspect_browser_excluded');
		});

		it('should cache schema results', async () => {
			const schema1 = await browser.getSchema();
			const schema2 = await browser.getSchema();

			// Same reference means cached
			expect(schema1).toBe(schema2);
		});

		it('should refresh cache when forceRefresh is true', async () => {
			const schema1 = await browser.getSchema();
			const schema2 = await browser.getSchema(true);

			// Different reference means new fetch
			expect(schema1).not.toBe(schema2);
		});
	});

	describe('getTableInfo', () => {
		it('should return table info for existing table', async () => {
			const tableInfo = await browser.getTableInfo(
				'introspect_browser_products',
			);

			expect(tableInfo).not.toBeNull();
			expect(tableInfo?.name).toBe('introspect_browser_products');
			expect(tableInfo?.columns.length).toBeGreaterThan(0);
		});

		it('should return null for non-existent table', async () => {
			const tableInfo = await browser.getTableInfo('non_existent_table');

			expect(tableInfo).toBeNull();
		});
	});

	describe('query', () => {
		it('should return paginated results', async () => {
			const result = await browser.query({
				table: 'introspect_browser_products',
				pageSize: 3,
			});

			expect(result.rows).toHaveLength(3);
			expect(result.hasMore).toBe(true);
			expect(result.nextCursor).toBeDefined();
		});

		it('should throw error for non-existent table', async () => {
			await expect(
				browser.query({ table: 'non_existent_table' }),
			).rejects.toThrow(TableNotFound);
		});

		it('should respect pageSize limit', async () => {
			const result = await browser.query({
				table: 'introspect_browser_products',
				pageSize: 2,
			});

			expect(result.rows).toHaveLength(2);
		});

		it('should cap pageSize at 100', async () => {
			// Insert more products
			const products = [];
			for (let i = 0; i < 110; i++) {
				products.push({
					name: `Product ${i}`,
					price: i * 10,
					category: 'test',
					inStock: true,
				});
			}
			await db
				.insertInto('introspectBrowserProducts')
				.values(products)
				.execute();

			const result = await browser.query({
				table: 'introspect_browser_products',
				pageSize: 150,
			});

			expect(result.rows.length).toBeLessThanOrEqual(100);
		});

		it('should paginate using cursor', async () => {
			const firstPage = await browser.query({
				table: 'introspect_browser_products',
				pageSize: 2,
			});

			expect(firstPage.rows).toHaveLength(2);
			expect(firstPage.nextCursor).toBeDefined();

			const secondPage = await browser.query({
				table: 'introspect_browser_products',
				pageSize: 2,
				cursor: firstPage.nextCursor,
			});

			expect(secondPage.rows).toHaveLength(2);

			// Items should be different
			const firstIds = firstPage.rows.map((r: any) => r.id);
			const secondIds = secondPage.rows.map((r: any) => r.id);
			expect(firstIds.every((id: number) => !secondIds.includes(id))).toBe(
				true,
			);
		});

		it('should apply filters', async () => {
			const result = await browser.query({
				table: 'introspect_browser_products',
				filters: [
					{
						column: 'category',
						operator: FilterOperator.Eq,
						value: 'electronics',
					},
				],
			});

			expect(result.rows).toHaveLength(3);
			result.rows.forEach((row: any) => {
				expect(row.category).toBe('electronics');
			});
		});

		it('should apply multiple filters', async () => {
			const result = await browser.query({
				table: 'introspect_browser_products',
				filters: [
					{
						column: 'category',
						operator: FilterOperator.Eq,
						value: 'electronics',
					},
					{ column: 'price', operator: FilterOperator.Gt, value: 150 },
				],
			});

			expect(result.rows).toHaveLength(2);
			result.rows.forEach((row: any) => {
				expect(row.category).toBe('electronics');
				expect(Number(row.price)).toBeGreaterThan(150);
			});
		});

		it('should apply sorting', async () => {
			const result = await browser.query({
				table: 'introspect_browser_products',
				sort: [{ column: 'price', direction: Direction.Desc }],
			});

			const prices = result.rows.map((r: any) => Number(r.price));
			for (let i = 1; i < prices.length; i++) {
				expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
			}
		});

		it('should handle empty results', async () => {
			const result = await browser.query({
				table: 'introspect_browser_products',
				filters: [
					{
						column: 'category',
						operator: FilterOperator.Eq,
						value: 'nonexistent',
					},
				],
			});

			expect(result.rows).toHaveLength(0);
			expect(result.hasMore).toBe(false);
			expect(result.nextCursor).toBeNull();
		});

		it('should set prevCursor when cursor is provided', async () => {
			const firstPage = await browser.query({
				table: 'introspect_browser_products',
				pageSize: 2,
			});

			const secondPage = await browser.query({
				table: 'introspect_browser_products',
				pageSize: 2,
				cursor: firstPage.nextCursor,
			});

			expect(secondPage.prevCursor).toBeDefined();
		});

		it('should not set prevCursor on first page', async () => {
			const result = await browser.query({
				table: 'introspect_browser_products',
				pageSize: 2,
			});

			expect(result.prevCursor).toBeNull();
		});
	});

	describe('getCursorConfig', () => {
		const products = async (from: DataBrowser<TestDatabase>) =>
			(await from.getTableInfo('introspect_browser_products'))!;

		it('should return default cursor config', async () => {
			const config = browser.getCursorConfig(await products(browser));

			expect(config).toEqual({ field: 'id', direction: Direction.Asc });
		});

		it('should return table-specific cursor config', async () => {
			const customBrowser = new DataBrowser({
				db,
				cursor: { field: 'id', direction: Direction.Asc },
				tableCursors: {
					introspect_browser_products: {
						field: 'created_at',
						direction: Direction.Desc,
					},
				},
			});

			const config = customBrowser.getCursorConfig(
				await products(customBrowser),
			);

			expect(config).toEqual({
				field: 'created_at',
				direction: Direction.Desc,
			});
		});

		it('pages by a single-column primary key when no cursor is configured', async () => {
			const bare = new DataBrowser<TestDatabase>({ db });

			expect(bare.getCursorConfig(await products(bare))).toEqual({
				field: 'id',
				direction: Direction.Asc,
			});

			const first = await bare.query({
				table: 'introspect_browser_products',
				pageSize: 2,
			});
			const second = await bare.query({
				table: 'introspect_browser_products',
				pageSize: 2,
				cursor: first.nextCursor,
			});
			const ids = [...first.rows, ...second.rows].map((r) => r.id as number);
			expect(ids).toEqual([...ids].sort((x, y) => x - y));
			expect(new Set(ids).size).toBe(4);
		});
	});

	describe('db', () => {
		it('should return the underlying database instance', () => {
			expect(browser.db).toBe(db);
		});
	});

	describe('cursor direction in query', () => {
		it('should use descending cursor direction correctly', async () => {
			const descBrowser = new DataBrowser({
				db,
				cursor: { field: 'id', direction: Direction.Desc },
				tableCursors: {},
				excludeTables: [],
				defaultPageSize: 10,
			});

			const result = await descBrowser.query({
				table: 'introspect_browser_products',
				pageSize: 3,
			});

			const ids = result.rows.map((r: any) => r.id);
			for (let i = 1; i < ids.length; i++) {
				expect(ids[i]).toBeLessThan(ids[i - 1]);
			}
		});
	});
});
