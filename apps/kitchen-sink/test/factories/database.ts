import { KyselyFactory } from '@geekmidas/testkit/kysely';
import type { Kysely } from 'kysely';
import type { Database } from '../../constructs/database.js';

const usersBuilder = KyselyFactory.createBuilder<Database, 'users'>(
	'users',
	({ faker }) => ({
		name: faker.person.fullName(),
		email: `${crypto.randomUUID()}@example.com`,
	}),
);

const builders = { users: usersBuilder };
const seeds = {};

/**
 * `Database`'s factory. `gkm test` finds it by its name, builds it on each
 * feature test's transaction, and hands it over as `factories.get('database')`.
 */
export function createFactory(db: Kysely<Database>) {
	return new KyselyFactory<Database, typeof builders, typeof seeds>(
		builders,
		seeds,
		db,
	);
}
