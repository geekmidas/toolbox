import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import type { Generated } from 'kysely';

/** Database schema. */
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
 * The app's database — one line where there used to be a service, a
 * `services: ['postgres']` entry, and a DATABASE_URL in three env files.
 *
 * Declaring it is what makes a Postgres exist locally: `gkm dev` reads this,
 * starts the container, creates `kitchensink` inside it, and injects
 * `KITCHEN_SINK_URL`. pg-boss keeps its queues in this same database, in its own
 * schema — which is why nothing else here mentions a broker.
 *
 * Both type arguments or neither: TypeScript has no partial type-argument
 * inference, so passing only `Database` would widen the service key to `string`.
 */
export const database = new KyselyDatabase<Database, 'KitchenSink'>(
	'KitchenSink',
);
