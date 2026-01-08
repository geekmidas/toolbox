import {
	CamelCasePlugin,
	type Generated,
	Kysely,
	PostgresDialect,
	sql,
} from 'kysely';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../testkit/test/globalSetup';
import { RLS_BYPASS, type RlsContext, withRlsContext } from '../rls';

interface TestDatabase {
	rlsTestOrders: {
		id: Generated<number>;
		tenantId: string;
		userId: string;
		amount: number;
		createdAt: Generated<Date>;
	};
}

describe('RLS Utility - Integration Tests', () => {
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
			.createTable('rls_test_orders')
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('tenant_id', 'varchar', (col) => col.notNull())
			.addColumn('user_id', 'varchar', (col) => col.notNull())
			.addColumn('amount', 'numeric(10, 2)', (col) => col.notNull())
			.addColumn('created_at', 'timestamp', (col) =>
				col.defaultTo(sql`now()`).notNull(),
			)
			.execute();
	});

	afterEach(async () => {
		// Clean up data after each test
		await db.deleteFrom('rlsTestOrders').execute();
	});

	afterAll(async () => {
		// Drop table and close connection
		await db.schema.dropTable('rls_test_orders').ifExists().execute();
		await db.destroy();
	});

	describe('withRlsContext', () => {
		it('should execute callback within transaction', async () => {
			const result = await withRlsContext(
				db,
				{ user_id: 'user-123' },
				async (trx) => {
					// Insert an order within the RLS context
					const order = await trx
						.insertInto('rlsTestOrders')
						.values({
							tenantId: 'tenant-1',
							userId: 'user-123',
							amount: 100,
						})
						.returningAll()
						.executeTakeFirstOrThrow();

					return order;
				},
			);

			expect(result.id).toBeDefined();
			expect(result.userId).toBe('user-123');
		});

		it('should set RLS context variables with set_config', async () => {
			const capturedValues = await withRlsContext(
				db,
				{ user_id: 'user-123', tenant_id: 'tenant-456' },
				async (trx) => {
					// Read the session variables using current_setting
					const userId = await sql<{ value: string }>`
            SELECT current_setting('app.user_id', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					const tenantId = await sql<{ value: string }>`
            SELECT current_setting('app.tenant_id', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					return { userId, tenantId };
				},
			);

			expect(capturedValues.userId).toBe('user-123');
			expect(capturedValues.tenantId).toBe('tenant-456');
		});

		it('should use custom prefix when specified', async () => {
			const capturedValue = await withRlsContext(
				db,
				{ user_id: 'user-123' },
				async (trx) => {
					const value = await sql<{ value: string }>`
            SELECT current_setting('rls.user_id', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					return value;
				},
				{ prefix: 'rls' },
			);

			expect(capturedValue).toBe('user-123');
		});

		it('should skip null and undefined values', async () => {
			const capturedValues = await withRlsContext(
				db,
				{
					user_id: 'user-123',
					nullable_field: null,
					undefined_field: undefined,
				},
				async (trx) => {
					const userId = await sql<{ value: string }>`
            SELECT current_setting('app.user_id', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					// These should return null since they weren't set
					const nullableField = await sql<{ value: string | null }>`
            SELECT current_setting('app.nullable_field', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					const undefinedField = await sql<{ value: string | null }>`
            SELECT current_setting('app.undefined_field', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					return { userId, nullableField, undefinedField };
				},
			);

			expect(capturedValues.userId).toBe('user-123');
			expect(capturedValues.nullableField).toBeNull();
			expect(capturedValues.undefinedField).toBeNull();
		});

		it('should convert number values to strings', async () => {
			const capturedValue = await withRlsContext(
				db,
				{ count: 42 },
				async (trx) => {
					return await sql<{ value: string }>`
            SELECT current_setting('app.count', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);
				},
			);

			expect(capturedValue).toBe('42');
		});

		it('should convert boolean values to strings', async () => {
			const capturedValues = await withRlsContext(
				db,
				{ is_admin: true, is_guest: false },
				async (trx) => {
					const isAdmin = await sql<{ value: string }>`
            SELECT current_setting('app.is_admin', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					const isGuest = await sql<{ value: string }>`
            SELECT current_setting('app.is_guest', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					return { isAdmin, isGuest };
				},
			);

			expect(capturedValues.isAdmin).toBe('true');
			expect(capturedValues.isGuest).toBe('false');
		});

		it('should propagate callback return value', async () => {
			const expectedResult = { id: 123, name: 'Test User' };

			const result = await withRlsContext(
				db,
				{ user_id: 'user-123' },
				async () => expectedResult,
			);

			expect(result).toEqual(expectedResult);
		});

		it('should propagate errors from callback', async () => {
			const error = new Error('Query failed');

			await expect(
				withRlsContext(db, { user_id: 'user-123' }, async () => {
					throw error;
				}),
			).rejects.toThrow('Query failed');
		});

		it('should handle empty context', async () => {
			const result = await withRlsContext(db, {}, async (trx) => {
				const order = await trx
					.insertInto('rlsTestOrders')
					.values({
						tenantId: 'tenant-1',
						userId: 'user-empty',
						amount: 50,
					})
					.returningAll()
					.executeTakeFirstOrThrow();

				return order;
			});

			expect(result.userId).toBe('user-empty');
		});

		it('should scope variables to transaction (not visible outside)', async () => {
			// Set a variable inside a transaction
			await withRlsContext(
				db,
				{ scoped_var: 'inside-transaction' },
				async (trx) => {
					// Verify it's set inside
					const inside = await sql<{ value: string }>`
            SELECT current_setting('app.scoped_var', true) as value
          `
						.execute(trx)
						.then((r) => r.rows[0]?.value);

					expect(inside).toBe('inside-transaction');
					return 'done';
				},
			);

			// Verify it's not the transaction value outside
			// PostgreSQL returns empty string for unset custom variables (not null)
			const outside = await sql<{ value: string | null }>`
        SELECT current_setting('app.scoped_var', true) as value
      `
				.execute(db)
				.then((r) => r.rows[0]?.value);

			// The value should NOT be 'inside-transaction' - it's cleared/reset
			expect(outside).not.toBe('inside-transaction');
			// PostgreSQL returns empty string for missing custom settings
			expect(outside === '' || outside === null).toBe(true);
		});

		it('should reuse existing transaction', async () => {
			const result = await withRlsContext(
				db,
				{ outer_var: 'outer' },
				async (outerTrx) => {
					// Nested withRlsContext should reuse the same transaction
					const innerResult = await withRlsContext(
						outerTrx,
						{ inner_var: 'inner' },
						async (innerTrx) => {
							// Both variables should be visible in nested context
							const outerVar = await sql<{ value: string }>`
                SELECT current_setting('app.outer_var', true) as value
              `
								.execute(innerTrx)
								.then((r) => r.rows[0]?.value);

							const innerVar = await sql<{ value: string }>`
                SELECT current_setting('app.inner_var', true) as value
              `
								.execute(innerTrx)
								.then((r) => r.rows[0]?.value);

							return { outerVar, innerVar };
						},
					);

					return innerResult;
				},
			);

			expect(result.outerVar).toBe('outer');
			expect(result.innerVar).toBe('inner');
		});

		it('should rollback on error including RLS context', async () => {
			try {
				await withRlsContext(
					db,
					{ rollback_test: 'should-rollback' },
					async (trx) => {
						await trx
							.insertInto('rlsTestOrders')
							.values({
								tenantId: 'tenant-rollback',
								userId: 'user-rollback',
								amount: 999,
							})
							.execute();

						throw new Error('Force rollback');
					},
				);
			} catch {
				// Expected error
			}

			// Verify the insert was rolled back
			const orders = await db
				.selectFrom('rlsTestOrders')
				.selectAll()
				.where('tenantId', '=', 'tenant-rollback')
				.execute();

			expect(orders).toHaveLength(0);
		});

		it('should pass transaction settings (isolation level)', async () => {
			const result = await withRlsContext(
				db,
				{ user_id: 'user-serializable' },
				async (trx) => {
					// This query should work under any isolation level
					const order = await trx
						.insertInto('rlsTestOrders')
						.values({
							tenantId: 'tenant-serializable',
							userId: 'user-serializable',
							amount: 200,
						})
						.returningAll()
						.executeTakeFirstOrThrow();

					return order;
				},
				{ settings: { isolationLevel: 'serializable' } },
			);

			expect(result.userId).toBe('user-serializable');
		});

		it('should support different return types', async () => {
			// Number
			const numResult = await withRlsContext(db, {}, async () => 42);
			expect(numResult).toBe(42);

			// String
			const strResult = await withRlsContext(db, {}, async () => 'test');
			expect(strResult).toBe('test');

			// Boolean
			const boolResult = await withRlsContext(db, {}, async () => true);
			expect(boolResult).toBe(true);

			// Array
			const arrResult = await withRlsContext(db, {}, async () => [1, 2, 3]);
			expect(arrResult).toEqual([1, 2, 3]);

			// Object
			const objResult = await withRlsContext(db, {}, async () => ({
				key: 'value',
			}));
			expect(objResult).toEqual({ key: 'value' });
		});
	});

	describe('RLS_BYPASS', () => {
		it('should be a unique symbol', () => {
			expect(typeof RLS_BYPASS).toBe('symbol');
			expect(RLS_BYPASS.description).toBe('geekmidas.rls.bypass');
		});

		it('should be the same symbol across imports', () => {
			const symbolFromGlobal = Symbol.for('geekmidas.rls.bypass');
			expect(RLS_BYPASS).toBe(symbolFromGlobal);
		});
	});

	describe('RlsContext type', () => {
		it('should accept string values', () => {
			const context: RlsContext = {
				user_id: 'user-123',
				tenant_id: 'tenant-456',
			};
			expect(context.user_id).toBe('user-123');
		});

		it('should accept number values', () => {
			const context: RlsContext = {
				count: 42,
				decimal: 3.14,
			};
			expect(context.count).toBe(42);
		});

		it('should accept boolean values', () => {
			const context: RlsContext = {
				is_admin: true,
				is_guest: false,
			};
			expect(context.is_admin).toBe(true);
		});

		it('should accept null and undefined values', () => {
			const context: RlsContext = {
				nullable: null,
				optional: undefined,
			};
			expect(context.nullable).toBe(null);
			expect(context.optional).toBe(undefined);
		});
	});
});
