import type { Kysely } from 'kysely';

/**
 * The plans a user can be on: reference data, owned by the seed beside these
 * migrations rather than by any request. The table is the migration's; its
 * rows are `db/database/seeds/001_plans.ts`'s.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('plans')
		.addColumn('id', 'varchar(32)', (col) => col.primaryKey())
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('monthly_cents', 'integer', (col) => col.notNull())
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('plans').execute();
}
