import { databaseFor } from '../constructs.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';

/**
 * Generate test infrastructure files when database is enabled.
 * Includes transaction-isolated test config, global setup with migrations,
 * factory system with builders/seeds, and an example spec.
 */
export function generateTestFiles(
	options: TemplateOptions,
	_template: TemplateConfig,
): GeneratedFile[] {
	if (!options.database) {
		return [];
	}

	// The keys the declared database publishes. Migrations connect as the owner
	// role — the one that may create, alter, and drop; a handler is never given
	// it, which is the security property the role split exists for.
	const db = databaseFor(options.name);

	// Single-app projects have no `~/*` alias, so what a test file imports
	// depends on where it will sit.
	const declares = !options.monorepo;
	const schema = declares
		? '../src/constructs/database.ts'
		: '~/services/database.ts';

	// Which key holds the URL: the one the construct publishes, or the one the
	// workspace's per-app secret sets.
	const runtimeUrl = declares ? db.urlKey : 'DATABASE_URL';
	const ownerUrl = declares ? db.ownerUrlKey : 'DATABASE_URL';

	return [
		// kysely.config.ts - Kysely CLI configuration for migrations
		{
			path: 'kysely.config.ts',
			content: `import { Credentials } from '@geekmidas/envkit/credentials';
import { PostgresDialect } from 'kysely';
import { defineConfig } from 'kysely-ctl';
import pg from 'pg';

// The owner role's URL — the one that may create, alter, and drop. Both keys
// are published by the declared database construct; run this under
// \`gkm exec -- pnpm kysely migrate:latest\` so they are injected.
const url = Credentials.${ownerUrl} ?? Credentials.${runtimeUrl};

export default defineConfig({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: url }),
  }),
  migrations: {
    migrationFolder: './src/db/migrations',
  },
});
`,
		},

		// test/config.ts - Wraps vitest `it` with transaction auto-rollback
		{
			path: 'test/config.ts',
			content: `import { it as itVitest } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';
import type { Database } from '${schema}';

const connection = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: process.env.${runtimeUrl} }),
  }),
});

export const it = wrapVitestKyselyTransaction<Database>(itVitest, {
  connection,
});
`,
		},

		// test/globalSetup.ts - Creates the test database and runs migrations
		{
			path: 'test/globalSetup.ts',
			content: `import fs from 'node:fs/promises';
import path from 'node:path';
import { Credentials } from '@geekmidas/envkit/credentials';
import { PostgresKyselyMigrator } from '@geekmidas/testkit/kysely';
import { Kysely, PostgresDialect } from 'kysely';
import { FileMigrationProvider } from 'kysely/migration';
import pg from 'pg';

export default async function globalSetup() {
  // \`gkm test\` reconciles the test stage before this runs: the container is
  // up, the database exists, and its roles are created. What is left is the
  // schema, which is what migrations are for.
  const databaseUrl = Credentials.${ownerUrl} ?? Credentials.${runtimeUrl}!;
  const migrationFolder = path.resolve(import.meta.dirname, '../src/db/migrations');

  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: databaseUrl }),
    }),
  });

  const migrator = new PostgresKyselyMigrator({
    uri: databaseUrl,
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  });

  const teardown = await migrator.start();
  return teardown;
}
`,
		},

		// test/factory/index.ts - Factory aggregator
		{
			path: 'test/factory/index.ts',
			content: `import type { Kysely } from 'kysely';
import { KyselyFactory } from '@geekmidas/testkit/kysely';
import type { Database } from '${schema}';
import { usersBuilder } from './users.ts';

const builders = { users: usersBuilder };
const seeds = {};

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

		// test/factory/users.ts - Example builder
		{
			path: 'test/factory/users.ts',
			content: `import { KyselyFactory } from '@geekmidas/testkit/kysely';
import type { Database } from '${schema}';

export const usersBuilder = KyselyFactory.createBuilder<Database, 'users'>(
  'users',
  ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    created_at: new Date(),
  }),
);
`,
		},

		// test/example.spec.ts - Example test showing usage
		{
			path: 'test/example.spec.ts',
			content: `import { describe, expect } from 'vitest';
import { it } from './config.ts';

describe('example', () => {
  it('should have a working test setup', async ({ db }) => {
    // db is a transaction-wrapped Kysely instance
    // All changes are automatically rolled back after the test
    expect(db).toBeDefined();
  });
});
`,
		},
	];
}
