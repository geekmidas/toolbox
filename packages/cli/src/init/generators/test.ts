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
		// kysely.config.ts - Kysely CLI configuration for migrations
		{
			path: 'kysely.config.ts',
			content: `import { Credentials } from '@geekmidas/envkit/credentials';
import { PostgresDialect } from 'kysely';
import { defineConfig } from 'kysely-ctl';
import pg from 'pg';

export default defineConfig({
  dialect: new PostgresDialect({
    pool: new pg.Pool({
      password: Credentials.POSTGRES_PASSWORD,
      user: Credentials.POSTGRES_USER,
      database: Credentials.POSTGRES_DB,
      port: Number(Credentials.POSTGRES_PORT),
      host: Credentials.POSTGRES_HOST,
    }),
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

		// test/globalSetup.ts - Creates test database, provisions users, runs migrations
		{
			path: 'test/globalSetup.ts',
			content: `import fs from 'node:fs/promises';
import path from 'node:path';
import { Credentials } from '@geekmidas/envkit/credentials';
import { PostgresKyselyMigrator } from '@geekmidas/testkit/kysely';
import { runInitScript } from '@geekmidas/testkit/postgres';
import { FileMigrationProvider, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export default async function globalSetup() {
  const databaseUrl = Credentials.DATABASE_URL!;
  const migrationFolder = path.resolve(import.meta.dirname, '../db/migrations');

  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: databaseUrl }),
    }),
  });

  const migrator = new PostgresKyselyMigrator({
    uri: databaseUrl,
    db,
    afterCreate: async (uri) => {
      const initScriptPath = path.resolve(process.cwd(), 'docker/postgres/init.sh');
      const dbUrl = new URL(Credentials.DATABASE_URL!);
      const apiUrl = new URL(Credentials.API_DATABASE_URL!);
      const authUrl = new URL(Credentials.AUTH_DATABASE_URL!);

      const env = {
        POSTGRES_USER: dbUrl.username,
        POSTGRES_DB: dbUrl.pathname.slice(1),
        API_DB_PASSWORD: decodeURIComponent(apiUrl.password),
        AUTH_DB_PASSWORD: decodeURIComponent(authUrl.password),
        PGBOSS_DB_PASSWORD: Credentials.PGBOSS_DB_PASSWORD ?? 'pgboss-dev-password',
      };

      await runInitScript(initScriptPath, uri, env);
    },
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
