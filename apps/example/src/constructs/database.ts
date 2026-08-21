import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import type { Generated } from 'kysely';

/**
 * Database schema definition.
 * Add your tables here.
 */
export interface Database {
	users: {
		id: Generated<string>;
		name: string;
		email: string;
		created_at: Generated<Date>;
		updated_at: Generated<Date>;
	};
}

/**
 * The app's database, declared once.
 *
 * This is the whole of what used to be a service, a `services: ['postgres']`
 * entry in the config, and a DATABASE_URL nobody could trace to a container.
 * The container, the database inside it, and `EXAMPLE_URL` all derive from this
 * line — `gkm dev` reconciles them before the server starts.
 *
 * Both type arguments or neither: TypeScript has no partial type-argument
 * inference, so passing only `Database` would leave the name at `string` and
 * widen the service key from `example`.
 */
export const database = new KyselyDatabase<Database, 'Example'>('Example');
