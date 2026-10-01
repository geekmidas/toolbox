import { kebabCase, serviceKey } from '@geekmidas/manifest';
import { databaseFor } from '../constructs.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';

/**
 * Generate test infrastructure files when database is enabled: the
 * transaction-isolated test config and an example spec, in the app. The
 * factory is the project's — see {@link generateTestFactoryFiles}.
 */
export function generateTestFiles(
	options: TemplateOptions,
	_template: TemplateConfig,
): GeneratedFile[] {
	if (!options.constructs.database) {
		return [];
	}

	// The keys the declared database publishes. Migrations connect as the owner
	// role — the one that may create, alter, and drop; a handler is never given
	// it, which is the security property the role split exists for.
	const db = databaseFor();

	// Single-app projects have no `~/*` alias, so what a test file imports
	// depends on where it will sit.
	const declares = !options.monorepo;
	const schema = declares
		? '../src/constructs/database.ts'
		: `@${options.name}/constructs/database.ts`;

	// Both layouts declare the same database, so both publish the same keys. A
	// monorepo used to read a per-app secret here instead, and rendered the
	// owner key as the runtime one — so its migrations ran as the role that may
	// create nothing, and failed on the first table.
	const runtimeUrl = db.urlKey;
	const ownerUrl = db.ownerUrlKey;

	return [
		// test/config.ts - Wraps vitest `it` with transaction auto-rollback
		{
			path: 'test/config.ts',
			content: `import { it as itVitest } from 'vitest';
import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';
import { type Database, database } from '${schema}';

export const it = wrapVitestKyselyTransaction<Database>(itVitest, {
  // The construct itself, so the tests connect the way the app does — with
  // the plugins it was given, \`CamelCasePlugin\` included.
  connection: database,
});
`,
		},

		// test/example.spec.ts - Example test showing usage
		{
			path: 'test/example.spec.ts',
			content: `import { describe, expect } from 'vitest';
import { it } from './config.ts';

describe('example', () => {
  it('should have a working test setup', async ({ trx }) => {
    // trx is a Kysely transaction; everything in it is rolled back after the
    // test
    expect(trx).toBeDefined();
  });
});
`,
		},
	];
}

/**
 * The database's test factory, at the project root:
 * `test/factories/<construct>.ts`.
 *
 * A factory belongs to a database, not to an app, so there is one per database
 * for the whole project. `gkm test` finds it by that name and hands every
 * feature test \`factories.get('database')\`, built on the test's transaction.
 */
export function generateTestFactoryFiles(
	options: TemplateOptions,
): GeneratedFile[] {
	if (!options.constructs.database) {
		return [];
	}

	const db = databaseFor();
	// From the project root: a single app keeps its constructs under `src/`, a
	// monorepo maps them through the root tsconfig.
	const schema = options.monorepo
		? `@${options.name}/constructs/database.ts`
		: '../../src/constructs/database.ts';

	return [
		{
			path: `test/factories/${kebabCase(db.id)}.ts`,
			content: `import type { Kysely } from 'kysely';
import { KyselyFactory } from '@geekmidas/testkit/kysely';
import type { Database } from '${schema}';

const usersBuilder = KyselyFactory.createBuilder<Database, 'users'>(
  'users',
  ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    createdAt: new Date(),
  }),
);

const builders = { users: usersBuilder };
const seeds = {};

/**
 * This database's factory. \`gkm test\` builds it on each feature test's
 * transaction and hands it over as \`factories.get('${serviceKey(db.id)}')\`.
 */
export function createFactory(db: Kysely<Database>) {
  return new KyselyFactory<Database, typeof builders, typeof seeds>(
    builders,
    seeds,
    db,
  );
}

export type Factory = ReturnType<typeof createFactory>;
`,
		},
	];
}
