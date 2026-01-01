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
import {
  Direction,
  decodeCursor,
  encodeCursor,
  paginatedSearch,
} from '../pagination';

interface TestDatabase {
  paginationTestItems: {
    id: Generated<number>;
    name: string;
    category: string;
    price: number;
    createdAt: Generated<Date>;
  };
}

describe('Pagination Integration Tests', () => {
  let db: Kysely<TestDatabase>;

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
      .createTable('pagination_test_items')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('category', 'varchar(100)', (col) => col.notNull())
      .addColumn('price', 'numeric(10, 2)', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) =>
        col.defaultTo(sql`now()`).notNull(),
      )
      .execute();
  });

  beforeEach(async () => {
    // Insert 25 test items
    const items = [];
    for (let i = 1; i <= 25; i++) {
      items.push({
        name: `Item ${String(i).padStart(2, '0')}`,
        category:
          i <= 10 ? 'category-a' : i <= 20 ? 'category-b' : 'category-c',
        price: i * 10,
      });
    }
    await db.insertInto('paginationTestItems').values(items).execute();
  });

  afterEach(async () => {
    await db.deleteFrom('paginationTestItems').execute();
  });

  afterAll(async () => {
    await db.schema.dropTable('pagination_test_items').ifExists().execute();
    await db.destroy();
  });

  describe('paginatedSearch', () => {
    it('should return first page of results with default settings', async () => {
      const result = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        limit: 10,
        mapRow: (row) => ({ id: row.id, name: row.name }),
      });

      expect(result.items).toHaveLength(10);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.cursor).toBeDefined();
    });

    it('should return second page using cursor', async () => {
      // Get first page
      const firstPage = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        limit: 10,
        mapRow: (row) => ({ id: row.id, name: row.name }),
        cursorDirection: Direction.Asc,
      });

      expect(firstPage.pagination.cursor).toBeDefined();

      // Get second page using cursor
      const secondPage = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        cursor: firstPage.pagination.cursor,
        limit: 10,
        mapRow: (row) => ({ id: row.id, name: row.name }),
        cursorDirection: Direction.Asc,
      });

      expect(secondPage.items).toHaveLength(10);
      expect(secondPage.pagination.total).toBe(25);
      expect(secondPage.pagination.hasMore).toBe(true);

      // Items should be different from first page
      const firstIds = firstPage.items.map((i) => i.id);
      const secondIds = secondPage.items.map((i) => i.id);
      expect(firstIds.every((id) => !secondIds.includes(id))).toBe(true);
    });

    it('should return last page with hasMore false', async () => {
      // Get all pages
      let cursor: string | undefined;
      let pages: { id: number; name: string }[][] = [];

      do {
        const page = await paginatedSearch({
          query: db.selectFrom('paginationTestItems').selectAll(),
          cursor,
          limit: 10,
          mapRow: (row) => ({ id: row.id, name: row.name }),
          cursorDirection: Direction.Asc,
        });

        pages.push(page.items);
        cursor = page.pagination.cursor;

        if (!page.pagination.hasMore) break;
      } while (cursor);

      // Should have 3 pages
      expect(pages).toHaveLength(3);
      expect(pages[0]).toHaveLength(10);
      expect(pages[1]).toHaveLength(10);
      expect(pages[2]).toHaveLength(5);

      // Total items should be 25
      const allItems = pages.flat();
      expect(allItems).toHaveLength(25);
    });

    it('should paginate in descending order', async () => {
      const result = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        limit: 5,
        mapRow: (row) => ({ id: row.id, name: row.name }),
        cursorDirection: Direction.Desc,
      });

      // First item should have highest ID
      const ids = result.items.map((i) => i.id);
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeLessThan(ids[i - 1]);
      }

      // Get second page
      const secondPage = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        cursor: result.pagination.cursor,
        limit: 5,
        mapRow: (row) => ({ id: row.id, name: row.name }),
        cursorDirection: Direction.Desc,
      });

      // All IDs in second page should be less than all in first page
      const maxSecondPage = Math.max(...secondPage.items.map((i) => i.id));
      const minFirstPage = Math.min(...ids);
      expect(maxSecondPage).toBeLessThan(minFirstPage);
    });

    it('should work with custom cursor field', async () => {
      const result = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        limit: 5,
        mapRow: (row) => ({ id: row.id, name: row.name, price: row.price }),
        cursorField: 'price',
        cursorDirection: Direction.Asc,
      });

      // Prices should be in ascending order
      const prices = result.items.map((i) => Number(i.price));
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeGreaterThan(prices[i - 1]);
      }

      // Cursor should contain the last price value
      expect(Number(result.pagination.cursor)).toBe(prices[prices.length - 1]);

      // Get second page
      const secondPage = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        cursor: result.pagination.cursor,
        limit: 5,
        mapRow: (row) => ({ id: row.id, name: row.name, price: row.price }),
        cursorField: 'price',
        cursorDirection: Direction.Asc,
      });

      // All prices in second page should be greater than cursor
      const minSecondPage = Math.min(
        ...secondPage.items.map((i) => Number(i.price)),
      );
      expect(minSecondPage).toBeGreaterThan(prices[prices.length - 1]);
    });

    it('should use default limit of 20', async () => {
      const result = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        mapRow: (row) => ({ id: row.id }),
      });

      expect(result.items).toHaveLength(20);
    });

    it('should work with filtered queries', async () => {
      const result = await paginatedSearch({
        query: db
          .selectFrom('paginationTestItems')
          .selectAll()
          .where('category', '=', 'category-a'),
        limit: 5,
        mapRow: (row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
        }),
      });

      expect(result.pagination.total).toBe(10); // Only category-a items
      expect(result.items).toHaveLength(5);
      result.items.forEach((item) => {
        expect(item.category).toBe('category-a');
      });
    });

    it('should handle empty result set', async () => {
      const result = await paginatedSearch({
        query: db
          .selectFrom('paginationTestItems')
          .selectAll()
          .where('category', '=', 'nonexistent'),
        limit: 10,
        mapRow: (row) => ({ id: row.id }),
      });

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.cursor).toBeUndefined();
    });

    it('should handle async mapRow function', async () => {
      const result = await paginatedSearch({
        query: db.selectFrom('paginationTestItems').selectAll(),
        limit: 5,
        mapRow: async (row) => {
          // Simulate async transformation
          await new Promise((resolve) => setTimeout(resolve, 1));
          return {
            id: row.id,
            displayName: `Product: ${row.name}`,
            priceFormatted: `$${Number(row.price).toFixed(2)}`,
          };
        },
      });

      expect(result.items).toHaveLength(5);
      result.items.forEach((item) => {
        expect(item.displayName).toMatch(/^Product: Item \d+$/);
        expect(item.priceFormatted).toMatch(/^\$\d+\.\d{2}$/);
      });
    });
  });

  describe('encodeCursor / decodeCursor', () => {
    it('should encode and decode string values', () => {
      const original = 'some-cursor-value';
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded).toBe(original);
    });

    it('should encode and decode number values', () => {
      const original = 12345;
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded).toBe(original);
    });

    it('should encode and decode Date values', () => {
      const original = new Date('2024-01-15T10:30:00.000Z');
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(original);
    });

    it('should produce URL-safe base64 encoding', () => {
      const encoded = encodeCursor('test/value+with=special');

      // Base64url should not contain +, /, or =
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it('should throw error for invalid cursor format', () => {
      expect(() => decodeCursor('invalid-cursor')).toThrow(
        'Invalid cursor format',
      );
    });

    it('should throw error for malformed JSON', () => {
      // Create valid base64url but with invalid JSON content
      const malformedCursor = Buffer.from('not-json').toString('base64url');
      expect(() => decodeCursor(malformedCursor)).toThrow(
        'Invalid cursor format',
      );
    });
  });
});
