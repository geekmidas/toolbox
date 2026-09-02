/**
 * What a scaffolded project declares, and the keys that derive from it.
 *
 * One place, because three generators need the same three facts: the template
 * writes `new KyselyDatabase<Database, 'Acme'>('Acme')`, the test setup reads
 * `ACME_OWNER_URL` to migrate, and Studio reads `ACME_URL` to connect. Deriving
 * all of them from `@geekmidas/manifest`'s own helpers is what keeps a
 * scaffolded project agreeing with the runtime that discovers it — the same
 * reason the constructs own both faces at runtime.
 */

import { canonicalId, provideKey, serviceKey } from '@geekmidas/manifest';
import type { GeneratedFile } from './templates/index.js';

/** The glob every generated config points at. One glob, every kind. */
export const CONSTRUCTS_GLOB = './src/constructs/**/*.ts';

export interface ScaffoldedConstruct {
	/** The canonical id — what the construct is declared under. */
	id: string;
	/** The key it is reached under in a handler's service record. */
	service: string;
	/** The runtime URL key the target publishes. */
	urlKey: string;
}

export interface ScaffoldedDatabase extends ScaffoldedConstruct {
	/** The DDL role's URL — what migrations connect as. */
	ownerUrlKey: string;
}

/**
 * The database a project named `name` declares.
 *
 * Named after the project rather than `Db`, so two apps in one workspace can
 * declare one each without colliding on an id or on an env key.
 */
export function databaseFor(name: string): ScaffoldedDatabase {
	const id = canonicalId(name);

	return {
		id,
		service: serviceKey(id),
		urlKey: provideKey(id, 'url'),
		ownerUrlKey: provideKey(id, 'ownerUrl'),
	};
}

/** The bucket a project named `name` declares. */
export function storageFor(name: string): ScaffoldedConstruct {
	const id = canonicalId(`${name}-uploads`);

	return { id, service: serviceKey(id), urlKey: provideKey(id, 'url') };
}

/** The mail sender a project named `name` declares. */
export function emailFor(name: string): ScaffoldedConstruct {
	const id = canonicalId(`${name}-mail`);

	return { id, service: serviceKey(id), urlKey: provideKey(id, 'url') };
}

/** The cache a project named `name` declares. */
export function cacheFor(name: string): ScaffoldedConstruct {
	const id = canonicalId(`${name}-cache`);

	return { id, service: serviceKey(id), urlKey: provideKey(id, 'url') };
}

/**
 * The files a project's declared database needs.
 *
 * Shared by every template, so a worker and an API declare the same database
 * the same way — and so the schema type, the migration, and the id the test
 * setup reads all come from one place.
 */
export function databaseFiles(name: string): GeneratedFile[] {
	const db = databaseFor(name);

	return [
		{
			path: 'src/constructs/database.ts',
			content: `import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import type { Generated } from 'kysely';

/** Your database schema. Add tables here. */
export interface Database {
  users: {
    id: Generated<string>;
    name: string;
    email: string;
    created_at: Generated<Date>;
  };
}

/**
 * The app's database, declared once.
 *
 * The container, the database inside it, its roles and schema, and
 * \`${db.urlKey}\` all derive from this line — \`gkm dev\` reconciles them
 * before the server starts, which is why nothing lists \`postgres\` anywhere.
 *
 * Both type arguments or neither: TypeScript has no partial type-argument
 * inference, so passing only \`Database\` would leave the name at \`string\`
 * and widen the service key away from \`${db.service}\`.
 */
export const database = new KyselyDatabase<Database, '${db.id}'>('${db.id}');
`,
		},
		{
			// The table the scaffolded endpoints and factories expect. Applied by
			// `gkm exec -- pnpm kysely migrate:latest`, or by the test setup.
			path: 'src/db/migrations/001_create_users.ts',
			content: `import type { Kysely } from 'kysely';

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
    .execute();

  await db.schema
    .createIndex('users_email_idx')
    .on('users')
    .column('email')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('users').execute();
}
`,
		},
	];
}
