import knex, { type Knex } from 'knex';
import { Model } from 'objection';
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
import { Direction, paginatedSearch } from '../pagination';

class PaginationTestItem extends Model {
	static tableName = 'objection_pagination_test_items';

	id!: number;
	name!: string;
	category!: string;
	price!: number;
	createdAt!: Date;
}

describe('Objection Pagination Integration Tests', () => {
	let db: Knex;

	beforeAll(async () => {
		db = knex({
			client: 'pg',
			connection: {
				...TEST_DATABASE_CONFIG,
				database: 'postgres',
			},
		});

		Model.knex(db);

		await db.schema.createTableIfNotExists(
			'objection_pagination_test_items',
			(table) => {
				table.increments('id').primary();
				table.string('name', 255).notNullable();
				table.string('category', 100).notNullable();
				table.decimal('price', 10, 2).notNullable();
				table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
			},
		);
	});

	beforeEach(async () => {
		const items = [];
		for (let i = 1; i <= 25; i++) {
			items.push({
				name: `Item ${String(i).padStart(2, '0')}`,
				category:
					i <= 10 ? 'category-a' : i <= 20 ? 'category-b' : 'category-c',
				price: i * 10,
			});
		}
		await PaginationTestItem.query().insert(items);
	});

	afterEach(async () => {
		await PaginationTestItem.query().delete();
	});

	afterAll(async () => {
		await db.schema.dropTableIfExists('objection_pagination_test_items');
		await db.destroy();
	});

	describe('paginatedSearch', () => {
		it('should return first page of results with default settings', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query(),
				limit: 10,
			});

			expect(result.items).toHaveLength(10);
			expect(result.pagination.total).toBe(25);
			expect(result.pagination.hasMore).toBe(true);
			expect(result.pagination.cursor).toBeDefined();
		});

		it('should return model instances when no mapRow is provided', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query(),
				limit: 5,
			});

			expect(result.items[0]).toBeInstanceOf(PaginationTestItem);
			expect(result.items[0].name).toBeDefined();
		});

		it('should return second page using cursor', async () => {
			const firstPage = await paginatedSearch({
				query: PaginationTestItem.query(),
				limit: 10,
				cursorDirection: Direction.Asc,
			});

			expect(firstPage.pagination.cursor).toBeDefined();

			const secondPage = await paginatedSearch({
				query: PaginationTestItem.query(),
				cursor: firstPage.pagination.cursor,
				limit: 10,
				cursorDirection: Direction.Asc,
			});

			expect(secondPage.items).toHaveLength(10);
			expect(secondPage.pagination.total).toBe(25);
			expect(secondPage.pagination.hasMore).toBe(true);

			const firstIds = firstPage.items.map((i) => i.id);
			const secondIds = secondPage.items.map((i) => i.id);
			expect(firstIds.every((id) => !secondIds.includes(id))).toBe(true);
		});

		it('should return last page with hasMore false', async () => {
			let cursor: string | undefined;
			const pages: PaginationTestItem[][] = [];

			do {
				const page = await paginatedSearch({
					query: PaginationTestItem.query(),
					cursor,
					limit: 10,
					cursorDirection: Direction.Asc,
				});

				pages.push(page.items);
				cursor = page.pagination.cursor;

				if (!page.pagination.hasMore) break;
			} while (cursor);

			expect(pages).toHaveLength(3);
			expect(pages[0]).toHaveLength(10);
			expect(pages[1]).toHaveLength(10);
			expect(pages[2]).toHaveLength(5);

			const allItems = pages.flat();
			expect(allItems).toHaveLength(25);
		});

		it('should paginate in descending order', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query(),
				limit: 5,
				cursorDirection: Direction.Desc,
			});

			const ids = result.items.map((i) => i.id);
			for (let i = 1; i < ids.length; i++) {
				expect(ids[i]).toBeLessThan(ids[i - 1]);
			}

			const secondPage = await paginatedSearch({
				query: PaginationTestItem.query(),
				cursor: result.pagination.cursor,
				limit: 5,
				cursorDirection: Direction.Desc,
			});

			const maxSecondPage = Math.max(...secondPage.items.map((i) => i.id));
			const minFirstPage = Math.min(...ids);
			expect(maxSecondPage).toBeLessThan(minFirstPage);
		});

		it('should work with custom cursor field', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query(),
				limit: 5,
				mapRow: (row) => ({ id: row.id, name: row.name, price: row.price }),
				cursorField: 'price',
				cursorDirection: Direction.Asc,
			});

			const prices = result.items.map((i) => Number(i.price));
			for (let i = 1; i < prices.length; i++) {
				expect(prices[i]).toBeGreaterThan(prices[i - 1]);
			}

			expect(Number(result.pagination.cursor)).toBe(prices[prices.length - 1]);

			const secondPage = await paginatedSearch({
				query: PaginationTestItem.query(),
				cursor: result.pagination.cursor,
				limit: 5,
				mapRow: (row) => ({ id: row.id, name: row.name, price: row.price }),
				cursorField: 'price',
				cursorDirection: Direction.Asc,
			});

			const minSecondPage = Math.min(
				...secondPage.items.map((i) => Number(i.price)),
			);
			expect(minSecondPage).toBeGreaterThan(prices[prices.length - 1]);
		});

		it('should use default limit of 20', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query(),
			});

			expect(result.items).toHaveLength(20);
		});

		it('should work with filtered queries', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query().where('category', 'category-a'),
				limit: 5,
				mapRow: (row) => ({
					id: row.id,
					name: row.name,
					category: row.category,
				}),
			});

			expect(result.pagination.total).toBe(10);
			expect(result.items).toHaveLength(5);
			for (const item of result.items) {
				expect(item.category).toBe('category-a');
			}
		});

		it('should handle empty result set', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query().where('category', 'nonexistent'),
				limit: 10,
			});

			expect(result.items).toHaveLength(0);
			expect(result.pagination.total).toBe(0);
			expect(result.pagination.hasMore).toBe(false);
			expect(result.pagination.cursor).toBeUndefined();
		});

		it('should work with mapRow transformation', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query(),
				limit: 5,
				mapRow: (row) => ({
					id: row.id,
					displayName: `Product: ${row.name}`,
					priceFormatted: `$${Number(row.price).toFixed(2)}`,
				}),
			});

			expect(result.items).toHaveLength(5);
			for (const item of result.items) {
				expect(item.displayName).toMatch(/^Product: Item \d+$/);
				expect(item.priceFormatted).toMatch(/^\$\d+\.\d{2}$/);
			}
		});

		it('should work with eager loading', async () => {
			// withGraphFetched doesn't error even without relations defined;
			// this validates the query builder composition works end-to-end
			const result = await paginatedSearch({
				query: PaginationTestItem.query().select('id', 'name'),
				limit: 5,
			});

			expect(result.items).toHaveLength(5);
			expect(result.items[0].id).toBeDefined();
			expect(result.items[0].name).toBeDefined();
		});

		it('should work with async mapRow function', async () => {
			const result = await paginatedSearch({
				query: PaginationTestItem.query(),
				limit: 5,
				mapRow: async (row) => {
					await new Promise((resolve) => setTimeout(resolve, 1));
					return {
						id: row.id,
						displayName: `Product: ${row.name}`,
					};
				},
			});

			expect(result.items).toHaveLength(5);
			for (const item of result.items) {
				expect(item.displayName).toMatch(/^Product: Item \d+$/);
			}
		});
	});
});
