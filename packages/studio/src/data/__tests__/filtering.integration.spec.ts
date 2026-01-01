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
  type ColumnInfo,
  Direction,
  FilterOperator,
  type TableInfo,
} from '../../types';
import { applyFilters, applySorting, validateFilter } from '../filtering';

interface TestDatabase {
  studioFilterProducts: {
    id: Generated<number>;
    name: string;
    price: number;
    category: string;
    inStock: boolean;
    rating: number | null;
    createdAt: Generated<Date>;
  };
}

describe('Filtering Integration Tests', () => {
  let db: Kysely<TestDatabase>;

  // Table info mock that matches our real table
  const productsTableInfo: TableInfo = {
    name: 'studio_filter_products',
    schema: 'public',
    columns: [
      {
        name: 'id',
        type: 'number',
        rawType: 'int4',
        nullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
      },
      {
        name: 'name',
        type: 'string',
        rawType: 'varchar',
        nullable: false,
        isPrimaryKey: false,
        isForeignKey: false,
      },
      {
        name: 'price',
        type: 'number',
        rawType: 'numeric',
        nullable: false,
        isPrimaryKey: false,
        isForeignKey: false,
      },
      {
        name: 'category',
        type: 'string',
        rawType: 'varchar',
        nullable: false,
        isPrimaryKey: false,
        isForeignKey: false,
      },
      {
        name: 'in_stock',
        type: 'boolean',
        rawType: 'bool',
        nullable: false,
        isPrimaryKey: false,
        isForeignKey: false,
      },
      {
        name: 'rating',
        type: 'number',
        rawType: 'numeric',
        nullable: true,
        isPrimaryKey: false,
        isForeignKey: false,
      },
      {
        name: 'created_at',
        type: 'datetime',
        rawType: 'timestamptz',
        nullable: false,
        isPrimaryKey: false,
        isForeignKey: false,
      },
    ],
    primaryKey: ['id'],
  };

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
      .createTable('studio_filter_products')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('price', 'numeric(10, 2)', (col) => col.notNull())
      .addColumn('category', 'varchar(100)', (col) => col.notNull())
      .addColumn('in_stock', 'boolean', (col) => col.notNull().defaultTo(true))
      .addColumn('rating', 'numeric(3, 2)')
      .addColumn('created_at', 'timestamptz', (col) =>
        col.defaultTo(sql`now()`).notNull(),
      )
      .execute();
  });

  beforeEach(async () => {
    // Insert test data
    await db
      .insertInto('studioFilterProducts')
      .values([
        {
          name: 'Laptop Pro',
          price: 1299.99,
          category: 'electronics',
          inStock: true,
          rating: 4.5,
        },
        {
          name: 'Laptop Basic',
          price: 599.99,
          category: 'electronics',
          inStock: true,
          rating: 3.8,
        },
        {
          name: 'Wireless Mouse',
          price: 49.99,
          category: 'electronics',
          inStock: false,
          rating: 4.2,
        },
        {
          name: 'Office Chair',
          price: 299.99,
          category: 'furniture',
          inStock: true,
          rating: 4.0,
        },
        {
          name: 'Standing Desk',
          price: 549.99,
          category: 'furniture',
          inStock: true,
          rating: null,
        },
        {
          name: 'Notebook',
          price: 9.99,
          category: 'office',
          inStock: true,
          rating: 3.5,
        },
        {
          name: 'Pen Set',
          price: 19.99,
          category: 'office',
          inStock: false,
          rating: 4.8,
        },
      ])
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('studioFilterProducts').execute();
  });

  afterAll(async () => {
    await db.schema.dropTable('studio_filter_products').ifExists().execute();
    await db.destroy();
  });

  describe('validateFilter', () => {
    it('should validate compatible operators for string columns', () => {
      const nameColumn: ColumnInfo = productsTableInfo.columns.find(
        (c) => c.name === 'name',
      )!;

      expect(
        validateFilter(
          { column: 'name', operator: FilterOperator.Eq, value: 'test' },
          nameColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'name', operator: FilterOperator.Like, value: '%test%' },
          nameColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'name', operator: FilterOperator.Ilike, value: '%TEST%' },
          nameColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'name', operator: FilterOperator.In, value: ['a', 'b'] },
          nameColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'name', operator: FilterOperator.IsNull },
          nameColumn,
        ).valid,
      ).toBe(true);
    });

    it('should reject incompatible operators for string columns', () => {
      const nameColumn: ColumnInfo = productsTableInfo.columns.find(
        (c) => c.name === 'name',
      )!;

      const result = validateFilter(
        { column: 'name', operator: FilterOperator.Gt, value: 'test' },
        nameColumn,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain(
        "Operator 'gt' not supported for column type 'string'",
      );
    });

    it('should validate compatible operators for number columns', () => {
      const priceColumn: ColumnInfo = productsTableInfo.columns.find(
        (c) => c.name === 'price',
      )!;

      expect(
        validateFilter(
          { column: 'price', operator: FilterOperator.Eq, value: 100 },
          priceColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'price', operator: FilterOperator.Gt, value: 100 },
          priceColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'price', operator: FilterOperator.Gte, value: 100 },
          priceColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'price', operator: FilterOperator.Lt, value: 100 },
          priceColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'price', operator: FilterOperator.Lte, value: 100 },
          priceColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'price', operator: FilterOperator.In, value: [100, 200] },
          priceColumn,
        ).valid,
      ).toBe(true);
    });

    it('should reject incompatible operators for number columns', () => {
      const priceColumn: ColumnInfo = productsTableInfo.columns.find(
        (c) => c.name === 'price',
      )!;

      const result = validateFilter(
        { column: 'price', operator: FilterOperator.Like, value: '%100%' },
        priceColumn,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain(
        "Operator 'like' not supported for column type 'number'",
      );
    });

    it('should validate compatible operators for boolean columns', () => {
      const inStockColumn: ColumnInfo = productsTableInfo.columns.find(
        (c) => c.name === 'in_stock',
      )!;

      expect(
        validateFilter(
          { column: 'in_stock', operator: FilterOperator.Eq, value: true },
          inStockColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'in_stock', operator: FilterOperator.Neq, value: false },
          inStockColumn,
        ).valid,
      ).toBe(true);
      expect(
        validateFilter(
          { column: 'in_stock', operator: FilterOperator.IsNull },
          inStockColumn,
        ).valid,
      ).toBe(true);
    });

    it('should reject incompatible operators for boolean columns', () => {
      const inStockColumn: ColumnInfo = productsTableInfo.columns.find(
        (c) => c.name === 'in_stock',
      )!;

      const result = validateFilter(
        { column: 'in_stock', operator: FilterOperator.Gt, value: true },
        inStockColumn,
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('applyFilters', () => {
    it('should apply equality filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [
          {
            column: 'category',
            operator: FilterOperator.Eq,
            value: 'electronics',
          },
        ],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r.category).toBe('electronics'));
    });

    it('should apply not-equal filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [
          {
            column: 'category',
            operator: FilterOperator.Neq,
            value: 'electronics',
          },
        ],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(4);
      results.forEach((r) => expect(r.category).not.toBe('electronics'));
    });

    it('should apply greater-than filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'price', operator: FilterOperator.Gt, value: 500 }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(3);
      results.forEach((r) => expect(Number(r.price)).toBeGreaterThan(500));
    });

    it('should apply greater-than-or-equal filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'price', operator: FilterOperator.Gte, value: 299.99 }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(4);
      results.forEach((r) =>
        expect(Number(r.price)).toBeGreaterThanOrEqual(299.99),
      );
    });

    it('should apply less-than filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'price', operator: FilterOperator.Lt, value: 50 }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(3);
      results.forEach((r) => expect(Number(r.price)).toBeLessThan(50));
    });

    it('should apply less-than-or-equal filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'price', operator: FilterOperator.Lte, value: 49.99 }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(3);
      results.forEach((r) =>
        expect(Number(r.price)).toBeLessThanOrEqual(49.99),
      );
    });

    it('should apply LIKE filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'name', operator: FilterOperator.Like, value: 'Laptop%' }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.name).toMatch(/^Laptop/));
    });

    it('should apply ILIKE filter (case-insensitive)', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'name', operator: FilterOperator.Ilike, value: '%LAPTOP%' }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.name.toLowerCase()).toContain('laptop'));
    });

    it('should apply IN filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [
          {
            column: 'category',
            operator: FilterOperator.In,
            value: ['electronics', 'furniture'],
          },
        ],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(5);
      results.forEach((r) =>
        expect(['electronics', 'furniture']).toContain(r.category),
      );
    });

    it('should apply NOT IN filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [
          {
            column: 'category',
            operator: FilterOperator.Nin,
            value: ['electronics', 'furniture'],
          },
        ],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.category).toBe('office'));
    });

    it('should apply IS NULL filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'rating', operator: FilterOperator.IsNull }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Standing Desk');
    });

    it('should apply IS NOT NULL filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'rating', operator: FilterOperator.IsNotNull }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(6);
      results.forEach((r) => expect(r.rating).not.toBeNull());
    });

    it('should apply boolean filter', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [{ column: 'in_stock', operator: FilterOperator.Eq, value: false }],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.inStock).toBe(false));
    });

    it('should apply multiple filters (AND)', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const filtered = applyFilters(
        baseQuery,
        [
          {
            column: 'category',
            operator: FilterOperator.Eq,
            value: 'electronics',
          },
          { column: 'in_stock', operator: FilterOperator.Eq, value: true },
          { column: 'price', operator: FilterOperator.Lt, value: 1000 },
        ],
        productsTableInfo,
      );

      const results = await filtered.execute();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Laptop Basic');
    });

    it('should throw error for unknown column', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();

      expect(() =>
        applyFilters(
          baseQuery,
          [
            {
              column: 'unknown_column',
              operator: FilterOperator.Eq,
              value: 'test',
            },
          ],
          productsTableInfo,
        ),
      ).toThrow(
        "Column 'unknown_column' not found in table 'studio_filter_products'",
      );
    });

    it('should throw error for invalid operator', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();

      expect(() =>
        applyFilters(
          baseQuery,
          [{ column: 'name', operator: FilterOperator.Gt, value: 'test' }],
          productsTableInfo,
        ),
      ).toThrow("Operator 'gt' not supported for column type 'string'");
    });
  });

  describe('applySorting', () => {
    it('should apply ascending sort', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const sorted = applySorting(
        baseQuery,
        [{ column: 'price', direction: Direction.Asc }],
        productsTableInfo,
      );

      const results = await sorted.execute();
      expect(results).toHaveLength(7);

      const prices = results.map((r) => Number(r.price));
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
      }
    });

    it('should apply descending sort', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const sorted = applySorting(
        baseQuery,
        [{ column: 'price', direction: Direction.Desc }],
        productsTableInfo,
      );

      const results = await sorted.execute();
      expect(results).toHaveLength(7);

      const prices = results.map((r) => Number(r.price));
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
      }
    });

    it('should apply multiple sorts', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const sorted = applySorting(
        baseQuery,
        [
          { column: 'category', direction: Direction.Asc },
          { column: 'price', direction: Direction.Desc },
        ],
        productsTableInfo,
      );

      const results = await sorted.execute();

      // Group by category and verify price order within each category
      const electronics = results.filter((r) => r.category === 'electronics');
      const furniture = results.filter((r) => r.category === 'furniture');

      // Electronics should be first (alphabetically before furniture)
      expect(results.slice(0, 3).map((r) => r.category)).toEqual([
        'electronics',
        'electronics',
        'electronics',
      ]);

      // Within electronics, prices should be descending
      const electronicsPrices = electronics.map((r) => Number(r.price));
      for (let i = 1; i < electronicsPrices.length; i++) {
        expect(electronicsPrices[i]).toBeLessThanOrEqual(
          electronicsPrices[i - 1],
        );
      }

      // Within furniture, prices should be descending
      const furniturePrices = furniture.map((r) => Number(r.price));
      for (let i = 1; i < furniturePrices.length; i++) {
        expect(furniturePrices[i]).toBeLessThanOrEqual(furniturePrices[i - 1]);
      }
    });

    it('should sort by string column', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();
      const sorted = applySorting(
        baseQuery,
        [{ column: 'name', direction: Direction.Asc }],
        productsTableInfo,
      );

      const results = await sorted.execute();
      const names = results.map((r) => r.name);

      // Verify alphabetical order
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });

    it('should throw error for unknown column in sort', async () => {
      const baseQuery = db.selectFrom('studioFilterProducts').selectAll();

      expect(() =>
        applySorting(
          baseQuery,
          [{ column: 'unknown_column', direction: Direction.Asc }],
          productsTableInfo,
        ),
      ).toThrow(
        "Column 'unknown_column' not found in table 'studio_filter_products'",
      );
    });
  });

  describe('combined filters and sorting', () => {
    it('should apply filters then sorting', async () => {
      let query = db.selectFrom('studioFilterProducts').selectAll();

      // Filter: in stock electronics
      query = applyFilters(
        query,
        [
          {
            column: 'category',
            operator: FilterOperator.Eq,
            value: 'electronics',
          },
          { column: 'in_stock', operator: FilterOperator.Eq, value: true },
        ],
        productsTableInfo,
      );

      // Sort by price descending
      query = applySorting(
        query,
        [{ column: 'price', direction: Direction.Desc }],
        productsTableInfo,
      );

      const results = await query.execute();

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Laptop Pro');
      expect(results[1].name).toBe('Laptop Basic');
    });
  });
});
