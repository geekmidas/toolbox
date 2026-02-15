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

	return [
		// test/config.ts - Wraps vitest `it` with transaction auto-rollback
		{
			path: 'test/config.ts',
			content: `import { it as itVitest } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';
import type { Database } from '~/services/database.ts';

const connection = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

export const it = wrapVitestKyselyTransaction<Database>(itVitest, {
  connection,
});
`,
		},

		// test/globalSetup.ts - Runs migrations on the test database
		// Note: gkm test automatically rewrites DATABASE_URL to use a _test
		// suffixed database and creates it if needed. This setup only runs
		// migrations.
		{
			path: 'test/globalSetup.ts',
			content: `import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { PostgresKyselyMigrator } from '@geekmidas/testkit/kysely';
import type { Database } from '~/services/database.ts';

export async function setup() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is required for tests');

  // Append _test suffix to database name
  const url = new URL(baseUrl);
  const testDbName = url.pathname.slice(1) + '_test';

  // Create test database if it doesn't exist
  const adminPool = new pg.Pool({ connectionString: baseUrl });
  try {
    await adminPool.query(\`CREATE DATABASE "\${testDbName}"\`);
  } catch (err: any) {
    if (err.code !== '42P04') throw err; // 42P04 = already exists
  } finally {
    await adminPool.end();
  }

  // Update URL to point to test database
  url.pathname = \`/\${testDbName}\`;
  const testUrl = url.toString();
  process.env.DATABASE_URL = testUrl;

  // Run migrations
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: testUrl }),
    }),
  });

  const migrator = new PostgresKyselyMigrator({
    db,
    migrationsPath: './src/migrations',
  });

  await migrator.migrateToLatest();
  await db.destroy();
}
`,
		},

		// test/factory/index.ts - Factory aggregator
		{
			path: 'test/factory/index.ts',
			content: `import type { Kysely } from 'kysely';
import { KyselyFactory } from '@geekmidas/testkit/kysely';
import type { Database } from '~/services/database.ts';
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
import type { Database } from '~/services/database.ts';

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
