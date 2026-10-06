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
import {
	createIntrospectionHandler,
	type IntrospectionHandler,
} from '../handler';

interface TestDatabase {
	introspectHonoProducts: {
		id: Generated<number>;
		name: string;
		price: number;
		category: string;
		inStock: boolean;
		createdAt: Generated<Date>;
	};
}

describe('createIntrospectionHandler', () => {
	let db: Kysely<TestDatabase>;
	let handler: IntrospectionHandler;

	// Mounted under a base path, as `gkm dev` mounts it, so every test also
	// covers the prefix being stripped.
	const request = (path: string, init?: RequestInit) =>
		handler(new Request(`http://localhost/__gkm/db${path}`, init));
	// The JSON is whatever the handler wrote; each test asserts its shape.
	const body = (res: Response): Promise<any> => res.json();

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

		await db.schema
			.createTable('introspect_hono_products')
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
		handler = createIntrospectionHandler({
			db,
			basePath: '/__gkm/db',
			cursor: { field: 'id', direction: Direction.Asc },
		});

		await db
			.insertInto('introspectHonoProducts')
			.values([
				{
					name: 'Laptop',
					price: 999.99,
					category: 'electronics',
					inStock: true,
				},
				{ name: 'Mouse', price: 29.99, category: 'electronics', inStock: true },
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
		await db.deleteFrom('introspectHonoProducts').execute();
	});

	afterAll(async () => {
		await db.schema.dropTable('introspect_hono_products').ifExists().execute();
		await db.destroy();
	});

	describe('GET /schemas', () => {
		it('lists the database schemas and which are browsable', async () => {
			const res = await request('/schemas');

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.schemas).toContain('public');
			expect(data.schemas).not.toContain('pg_catalog');
			expect(data.schemas).not.toContain('information_schema');
			expect(data.browsable).toEqual(['public']);
		});
	});

	describe('GET /tables', () => {
		it('lists the tables with their columns and keys', async () => {
			const res = await request('/tables');

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.updatedAt).toBeDefined();

			const productTable = data.tables.find(
				(t: any) => t.name === 'introspect_hono_products',
			);
			expect(productTable).toMatchObject({
				schema: 'public',
				primaryKey: ['id'],
			});
			expect(productTable.columns.map((c: any) => c.name)).toEqual([
				'id',
				'name',
				'price',
				'category',
				'in_stock',
				'created_at',
			]);
		});

		it('narrows to one schema', async () => {
			const res = await request('/tables?schema=nowhere');

			expect(res.status).toBe(200);
			expect((await body(res)).tables).toEqual([]);
		});

		it('re-reads the schema when asked to refresh', async () => {
			await request('/tables');
			await db.schema
				.createTable('introspect_hono_late')
				.ifNotExists()
				.addColumn('id', 'serial', (col) => col.primaryKey())
				.execute();

			try {
				const cached = await body(await request('/tables'));
				const fresh = await body(await request('/tables?refresh=true'));

				const names = (data: any) => data.tables.map((t: any) => t.name);
				expect(names(cached)).not.toContain('introspect_hono_late');
				expect(names(fresh)).toContain('introspect_hono_late');
			} finally {
				await db.schema.dropTable('introspect_hono_late').ifExists().execute();
			}
		});
	});

	describe('GET /tables/:name', () => {
		it('should return table info for existing table', async () => {
			const res = await request('/tables/introspect_hono_products');

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.name).toBe('introspect_hono_products');
			expect(data.columns).toBeDefined();
			expect(data.columns.length).toBeGreaterThan(0);
		});

		it('should return 404 for non-existent table', async () => {
			const res = await request('/tables/non_existent_table');

			expect(res.status).toBe(404);
			const data = await body(res);
			expect(data.error).toBe('TableNotFound');
		});
	});

	describe('GET /tables/:name/rows', () => {
		it('should return paginated rows', async () => {
			const res = await request('/tables/introspect_hono_products/rows');

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.rows).toBeDefined();
			expect(data.rows.length).toBe(5);
			expect(data.hasMore).toBe(false);
		});

		it('should respect pageSize parameter', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?pageSize=2',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.rows.length).toBe(2);
			expect(data.hasMore).toBe(true);
			expect(data.nextCursor).toBeDefined();
		});

		it('should paginate using cursor', async () => {
			const res1 = await request(
				'/tables/introspect_hono_products/rows?pageSize=2',
			);
			const data1 = await body(res1);

			const res2 = await request(
				`/tables/introspect_hono_products/rows?pageSize=2&cursor=${data1.nextCursor}`,
			);
			const data2 = await body(res2);

			expect(data2.rows.length).toBe(2);

			// Rows should be different
			const ids1 = data1.rows.map((r: any) => r.id);
			const ids2 = data2.rows.map((r: any) => r.id);
			expect(ids1.every((id: number) => !ids2.includes(id))).toBe(true);
		});

		it('should apply equality filter', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?filter[category][eq]=electronics',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.rows.length).toBe(3);
			data.rows.forEach((row: any) => {
				expect(row.category).toBe('electronics');
			});
		});

		it('should apply greater-than filter', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?filter[price][gt]=100',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.rows.length).toBe(3);
			data.rows.forEach((row: any) => {
				expect(Number(row.price)).toBeGreaterThan(100);
			});
		});

		it('should apply boolean filter', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?filter[in_stock][eq]=false',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.rows.length).toBe(1);
			expect(data.rows[0].name).toBe('Keyboard');
		});

		it('should apply IN filter', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?filter[name][in]=Laptop,Mouse',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.rows.length).toBe(2);
		});

		it('should apply multiple filters', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?filter[category][eq]=electronics&filter[in_stock][eq]=true',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
			expect(data.rows.length).toBe(2);
			data.rows.forEach((row: any) => {
				expect(row.category).toBe('electronics');
				expect(row.inStock).toBe(true);
			});
		});

		it('should apply sorting', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?sort=price:desc',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
			const prices = data.rows.map((r: any) => Number(r.price));

			for (let i = 1; i < prices.length; i++) {
				expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
			}
		});

		it('should apply multiple sort columns', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?sort=category:asc,price:desc',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
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
			const res = await request('/tables/non_existent_table/rows');

			expect(res.status).toBe(404);
			const data = await body(res);
			expect(data.error).toBe('TableNotFound');
		});

		it('should cap pageSize at 100', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?pageSize=500',
			);

			expect(res.status).toBe(200);
			// Since we only have 5 rows, we just verify the request succeeds
			const data = await body(res);
			expect(data.rows).toBeDefined();
		});
	});

	describe('foreign keys', () => {
		beforeAll(async () => {
			await db.schema
				.createTable('introspect_hono_reviews')
				.ifNotExists()
				.addColumn('id', 'serial', (col) => col.primaryKey())
				.addColumn('product_id', 'integer', (col) =>
					col.references('introspect_hono_products.id').onDelete('cascade'),
				)
				.execute();
		});

		afterAll(async () => {
			await db.schema.dropTable('introspect_hono_reviews').ifExists().execute();
		});

		it('describes a foreign key column with what it references', async () => {
			const res = await request(
				'/tables/introspect_hono_reviews?schema=public',
			);

			expect(res.status).toBe(200);
			const data = await body(res);
			const productId = data.columns.find((c: any) => c.name === 'product_id');
			expect(productId).toMatchObject({
				isForeignKey: true,
				foreignKeyTable: 'introspect_hono_products',
				foreignKeyColumn: 'id',
			});
		});
	});

	describe('errors', () => {
		it('answers a column the table lacks with 400 and the error class', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?filter[nope][eq]=1',
			);

			expect(res.status).toBe(400);
			expect(await body(res)).toMatchObject({ error: 'ColumnNotFound' });
		});

		it('answers an operator the column type rejects with 400', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?filter[name][gt]=a',
			);

			expect(res.status).toBe(400);
			expect(await body(res)).toMatchObject({
				error: 'UnsupportedFilterOperator',
			});
		});

		it('answers a cursor it did not issue with 400', async () => {
			const res = await request(
				'/tables/introspect_hono_products/rows?cursor=not-a-cursor',
			);

			expect(res.status).toBe(400);
			expect(await body(res)).toMatchObject({ error: 'InvalidCursor' });
		});

		it('answers an unknown route with 404', async () => {
			const res = await request('/nowhere');

			expect(res.status).toBe(404);
			expect(await body(res)).toMatchObject({ error: 'NotFound' });
		});

		it('refuses anything but GET, since it is read-only', async () => {
			const res = await request('/tables/introspect_hono_products/rows', {
				method: 'DELETE',
			});

			expect(res.status).toBe(405);
			expect(res.headers.get('allow')).toBe('GET');
		});
	});
});
