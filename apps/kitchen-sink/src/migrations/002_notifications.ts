import type { Kysely } from 'kysely';

/**
 * What the topic subscriber writes when it hears about a user.
 *
 * The subscriber used to log and nothing else, which made fan-out real but not
 * *observable*: the only way to assert it had happened was to scrape stdout,
 * which passes for the wrong reasons and fails for them too. A row is the same
 * evidence in a form a test can query and a person can look at.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('notifications')
		.addColumn('id', 'uuid', (col) =>
			col.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('user_id', 'uuid', (col) => col.notNull())
		// The topic's event type — `user.created` or `user.updated`. Text rather
		// than an enum: the contract lives in the topic's schema, and a database
		// enum would be a second place to change when an event is added.
		.addColumn('type', 'varchar(64)', (col) => col.notNull())
		.addColumn('body', 'text', (col) => col.notNull())
		.addColumn('read_at', 'timestamptz')
		.addColumn('created_at', 'timestamptz', (col) =>
			col.notNull().defaultTo(db.fn('now')),
		)
		.execute();

	await db.schema
		.createIndex('notifications_user_id_created_at_idx')
		.on('notifications')
		.columns(['user_id', 'created_at'])
		.execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('notifications').execute();
}
