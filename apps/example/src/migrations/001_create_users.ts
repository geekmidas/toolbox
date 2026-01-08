import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('users')
		.addColumn('id', 'uuid', (col) =>
			col.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
		.addColumn('created_at', 'timestamptz', (col) =>
			col.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (col) =>
			col.notNull().defaultTo(db.fn('now')),
		)
		.execute();

	// Create index on email for faster lookups
	await db.schema
		.createIndex('users_email_idx')
		.on('users')
		.column('email')
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('users').execute();
}
