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

interface RlsPolicyDatabase {
	rlsPolicyItems: {
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

	describe('RLS Policy Enforcement', () => {
		let adminDb: Kysely<RlsPolicyDatabase>;
		let userDb: Kysely<RlsPolicyDatabase>;

		beforeAll(async () => {
			// Admin connection (superuser bypasses RLS)
			adminDb = new Kysely<RlsPolicyDatabase>({
				dialect: new PostgresDialect({
					pool: new pg.Pool({
						...TEST_DATABASE_CONFIG,
						database: 'postgres',
					}),
				}),
				plugins: [new CamelCasePlugin()],
			});

			// Clean up from any previous failed runs
			await sql`DROP TABLE IF EXISTS rls_policy_items CASCADE`.execute(
				adminDb,
			);

			// Create non-superuser role (RLS doesn't apply to superusers)
			await sql`
				DO $$ BEGIN
					IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_test_role') THEN
						CREATE ROLE rls_test_role LOGIN PASSWORD 'rls_test_pass';
					END IF;
				END $$
			`.execute(adminDb);

			// Create table
			await adminDb.schema
				.createTable('rls_policy_items')
				.addColumn('id', 'serial', (col) => col.primaryKey())
				.addColumn('tenant_id', 'varchar', (col) => col.notNull())
				.addColumn('user_id', 'varchar', (col) => col.notNull())
				.addColumn('amount', 'numeric(10, 2)', (col) => col.notNull())
				.addColumn('created_at', 'timestamp', (col) =>
					col.defaultTo(sql`now()`).notNull(),
				)
				.execute();

			// Enable RLS
			await sql`ALTER TABLE rls_policy_items ENABLE ROW LEVEL SECURITY`.execute(
				adminDb,
			);

			// Create tenant isolation policies
			await sql`
				CREATE POLICY tenant_select ON rls_policy_items
					FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true))
			`.execute(adminDb);

			await sql`
				CREATE POLICY tenant_insert ON rls_policy_items
					FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
			`.execute(adminDb);

			await sql`
				CREATE POLICY tenant_update ON rls_policy_items
					FOR UPDATE
					USING (tenant_id = current_setting('app.tenant_id', true))
					WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
			`.execute(adminDb);

			await sql`
				CREATE POLICY tenant_delete ON rls_policy_items
					FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true))
			`.execute(adminDb);

			// Grant permissions to test role
			await sql`GRANT ALL ON rls_policy_items TO rls_test_role`.execute(
				adminDb,
			);
			await sql`GRANT USAGE, SELECT ON SEQUENCE rls_policy_items_id_seq TO rls_test_role`.execute(
				adminDb,
			);

			// Seed data as admin (superuser bypasses RLS)
			await adminDb
				.insertInto('rlsPolicyItems')
				.values([
					{ tenantId: 'tenant-a', userId: 'user-1', amount: 100 },
					{ tenantId: 'tenant-a', userId: 'user-2', amount: 200 },
					{ tenantId: 'tenant-b', userId: 'user-3', amount: 300 },
					{ tenantId: 'tenant-b', userId: 'user-4', amount: 400 },
					{ tenantId: 'tenant-c', userId: 'user-5', amount: 500 },
				])
				.execute();

			// Create connection as non-superuser (subject to RLS policies)
			userDb = new Kysely<RlsPolicyDatabase>({
				dialect: new PostgresDialect({
					pool: new pg.Pool({
						host: TEST_DATABASE_CONFIG.host,
						port: TEST_DATABASE_CONFIG.port,
						user: 'rls_test_role',
						password: 'rls_test_pass',
						database: 'postgres',
					}),
				}),
				plugins: [new CamelCasePlugin()],
			});
		});

		afterAll(async () => {
			await userDb.destroy();
			await sql`DROP TABLE IF EXISTS rls_policy_items CASCADE`.execute(
				adminDb,
			);
			await sql`DROP ROLE IF EXISTS rls_test_role`.execute(adminDb);
			await adminDb.destroy();
		});

		it('should only return rows matching the tenant context', async () => {
			const rows = await withRlsContext(
				userDb,
				{ tenant_id: 'tenant-a' },
				async (trx) => {
					return trx.selectFrom('rlsPolicyItems').selectAll().execute();
				},
			);

			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.tenantId === 'tenant-a')).toBe(true);
		});

		it('should completely isolate tenants from each other', async () => {
			const rows = await withRlsContext(
				userDb,
				{ tenant_id: 'tenant-b' },
				async (trx) => {
					return trx.selectFrom('rlsPolicyItems').selectAll().execute();
				},
			);

			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.tenantId === 'tenant-b')).toBe(true);
			const userIds = rows.map((r) => r.userId);
			expect(userIds).not.toContain('user-1');
			expect(userIds).not.toContain('user-2');
		});

		it('should return no rows when tenant context is not set', async () => {
			const rows = await withRlsContext(
				userDb,
				{},
				async (trx) => {
					return trx.selectFrom('rlsPolicyItems').selectAll().execute();
				},
			);

			expect(rows).toHaveLength(0);
		});

		it('should allow inserting rows that match the tenant context', async () => {
			const row = await withRlsContext(
				userDb,
				{ tenant_id: 'tenant-a' },
				async (trx) => {
					return trx
						.insertInto('rlsPolicyItems')
						.values({
							tenantId: 'tenant-a',
							userId: 'user-insert-test',
							amount: 999,
						})
						.returningAll()
						.executeTakeFirstOrThrow();
				},
			);

			expect(row.tenantId).toBe('tenant-a');
			expect(row.userId).toBe('user-insert-test');

			// Clean up
			await sql`DELETE FROM rls_policy_items WHERE user_id = 'user-insert-test'`.execute(
				adminDb,
			);
		});

		it('should reject inserting rows that violate the tenant policy', async () => {
			await expect(
				withRlsContext(
					userDb,
					{ tenant_id: 'tenant-a' },
					async (trx) => {
						return trx
							.insertInto('rlsPolicyItems')
							.values({
								tenantId: 'tenant-b',
								userId: 'user-cross-tenant',
								amount: 666,
							})
							.execute();
					},
				),
			).rejects.toThrow(/row-level security/i);
		});

		it('should not update rows belonging to another tenant', async () => {
			const result = await withRlsContext(
				userDb,
				{ tenant_id: 'tenant-a' },
				async (trx) => {
					return trx
						.updateTable('rlsPolicyItems')
						.set({ amount: 111 })
						.where('userId', '=', 'user-3') // belongs to tenant-b
						.executeTakeFirst();
				},
			);

			expect(Number(result.numUpdatedRows)).toBe(0);

			// Verify row is unchanged
			const unchanged = await sql<{ amount: string }>`
				SELECT amount FROM rls_policy_items WHERE user_id = 'user-3'
			`
				.execute(adminDb)
				.then((r) => r.rows[0]);

			expect(Number(unchanged?.amount)).toBe(300);
		});

		it('should reject updates that reassign a row to another tenant', async () => {
			await expect(
				withRlsContext(
					userDb,
					{ tenant_id: 'tenant-a' },
					async (trx) => {
						return trx
							.updateTable('rlsPolicyItems')
							.set({ tenantId: 'tenant-b' })
							.where('userId', '=', 'user-1')
							.execute();
					},
				),
			).rejects.toThrow(/row-level security/i);
		});

		it('should not delete rows belonging to another tenant', async () => {
			const result = await withRlsContext(
				userDb,
				{ tenant_id: 'tenant-a' },
				async (trx) => {
					return trx
						.deleteFrom('rlsPolicyItems')
						.where('userId', '=', 'user-3') // belongs to tenant-b
						.executeTakeFirst();
				},
			);

			expect(Number(result.numDeletedRows)).toBe(0);
		});

		it('should allow deleting rows belonging to the current tenant', async () => {
			// Insert a row to delete
			await sql`
				INSERT INTO rls_policy_items (tenant_id, user_id, amount)
				VALUES ('tenant-a', 'user-to-delete', 999)
			`.execute(adminDb);

			const result = await withRlsContext(
				userDb,
				{ tenant_id: 'tenant-a' },
				async (trx) => {
					return trx
						.deleteFrom('rlsPolicyItems')
						.where('userId', '=', 'user-to-delete')
						.executeTakeFirst();
				},
			);

			expect(Number(result.numDeletedRows)).toBe(1);
		});
	});
});
