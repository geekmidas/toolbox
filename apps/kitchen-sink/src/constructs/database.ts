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
	/**
	 * What the topic subscriber writes when it hears about a user.
	 *
	 * Fan-out with somewhere to land: the subscriber used to log, which is real
	 * but not observable — a test could only scrape stdout for it. A row is the
	 * same evidence in a form both a query and a person can read.
	 */
	notifications: {
		id: Generated<string>;
		user_id: string;
		type: string;
		body: string;
		read_at: Date | null;
		created_at: Generated<Date>;
	};
}

/**
 * The app's database — one line where there used to be a service, a
 * `services: ['postgres']` entry, and a DATABASE_URL in three env files.
 *
 * Called `Database` rather than `KitchenSink`: the id names the construct
 * *within* the app, and the app is already `kitchen-sink`. Repeating it produced
 * `production-kitchen-sink-kitchen-sink` on the provider and `KITCHEN_SINK_URL`
 * for a key whose only reader is this app — both saying the same word twice.
 *
 * Declaring it is what makes a Postgres exist locally: `gkm dev` reads this,
 * starts the container, creates `kitchensink` inside it, and injects
 * `DATABASE_URL`. pg-boss keeps its queues in this same database, in its own
 * schema — which is why nothing else here mentions a broker.
 *
 * Both type arguments or neither: TypeScript has no partial type-argument
 * inference, so passing only `Database` would widen the service key to `string`.
 */
export const database = new KyselyDatabase<Database, 'Database'>('Database');

/**
 * A read-only endpoint on the same database.
 *
 * Locally, and on any single-node deployment, this resolves to the same
 * Postgres the writer does — and that is safe rather than a loophole, because
 * read-only is enforced by the `kitchensink_reader` role's grants and not by
 * which endpoint the URL happens to name. On Aurora it resolves to the
 * cluster's reader endpoint, which exists without anything creating a replica.
 *
 * Nothing here changes when the topology does, which is the point.
 */
export const reader = database.reader();
