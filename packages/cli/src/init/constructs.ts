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

import { migrationFolder, provideKey, serviceKey } from '@geekmidas/manifest';
import { stamp } from '../migrate/names.js';
import type { GeneratedFile, RoutesStructure } from './templates/index.js';

/** The glob every generated config points at. One glob, every kind. */
export const CONSTRUCTS_GLOB = './src/constructs/**/*.ts';

/**
 * Where a workspace keeps its constructs: at the root, beside the apps that
 * share them, rather than inside any one of them.
 */
export const WORKSPACE_CONSTRUCTS_GLOB = './constructs/**/*.ts';

/**
 * Where each routes structure puts an app's handlers, relative to the app.
 *
 * `.ts` only, never `.tsx`: a TanStack site keeps its own `src/routes/`, and
 * this glob must not import a frontend's route components.
 */
export function routesGlob(structure: RoutesStructure): string {
	switch (structure) {
		case 'centralized-endpoints':
			return './src/endpoints/**/*.ts';
		case 'centralized-routes':
			return './src/routes/**/*.ts';
		case 'domain-based':
			return './src/**/routes/*.ts';
	}
}

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
 * Plain ids — `Database`, not `Beetlefit`.
 *
 * The workspace `name` already scopes every physical name
 * (`production-beetlefit-database`), so an id that carried the project too
 * would say it twice: `production-beetlefit-beetlefit-cache`. Within a
 * workspace the constructs are declared once, at its root, so there is no
 * second app's `Database` to collide with.
 */
function scaffolded(id: string): ScaffoldedConstruct {
	return { id, service: serviceKey(id), urlKey: provideKey(id, 'url') };
}

/** The database a project declares. */
export function databaseFor(): ScaffoldedDatabase {
	return {
		...scaffolded('Database'),
		ownerUrlKey: provideKey('Database', 'ownerUrl'),
	};
}

/** The bucket a project declares. */
export const storageFor = (): ScaffoldedConstruct => scaffolded('Uploads');

/** The mail sender a project declares. */
export const emailFor = (): ScaffoldedConstruct => scaffolded('Mail');

/** The cache a project declares. */
export const cacheFor = (): ScaffoldedConstruct => scaffolded('Cache');

/**
 * The files a project's declared database needs.
 *
 * Shared by every template, so a worker and an API declare the same database
 * the same way — and so the schema type, the migration, and the id the test
 * setup reads all come from one place.
 */
export function databaseFiles(): GeneratedFile[] {
	const db = databaseFor();

	return [
		{
			path: 'src/constructs/database.ts',
			content: `import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { CamelCasePlugin, type Generated } from 'kysely';

/**
 * Your database schema. Add tables here.
 *
 * camelCase, because of the plugin below: the columns are snake_case in
 * Postgres (\`created_at\`), and Kysely maps between the two.
 */
export interface Database {
  users: {
    id: Generated<string>;
    name: string;
    email: string;
    createdAt: Generated<Date>;
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
export const database = new KyselyDatabase<Database, '${db.id}'>('${db.id}', {
  // Yours to keep, change or remove. Every connection this construct opens —
  // every endpoint, the tests — uses it.
  plugins: [new CamelCasePlugin()],
});
`,
		},
		usersMigration(),
	];
}

/**
 * The table the scaffolded endpoints and factories expect.
 *
 * Its own function because a workspace's API needs it without the database
 * construct beside it — that one lives at the workspace root.
 */
export function usersMigration(): GeneratedFile {
	return {
		// The table the scaffolded endpoints and factories expect, in the folder
		// named by the database construct. Applied by `gkm migrate`, and by the
		// test setup before any test runs.
		path: `${migrationFolder(databaseFor().id)}/${stamp()}_create_users.ts`,
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
	};
}

/**
 * What a workspace's `constructs` glob reaches: the root constructs, and the
 * handlers of every app laid out the way `init` was told.
 *
 * Every app in `appsDir` (`apps/*`) rather than the API's own directory.
 * Endpoints are split by the surface they were built from, so naming one app
 * here would only decide which apps' endpoints are silently never loaded.
 */
export function workspaceConstructsGlobs(
	structure: RoutesStructure,
	appsDir: string,
): string[] {
	return [
		WORKSPACE_CONSTRUCTS_GLOB,
		`./${appsDir}/*/${routesGlob(structure).replace(/^\.\//, '')}`,
	];
}
