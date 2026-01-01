import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
} from 'kysely';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString:
          process.env.DATABASE_URL ??
          'postgresql://geekmidas:geekmidas@localhost:5432/examples',
      }),
    }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.info(`✅ Migration "${result.migrationName}" executed successfully`);
    } else if (result.status === 'Error') {
      console.error(`❌ Migration "${result.migrationName}" failed`);
    }
  }

  if (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }

  await db.destroy();
  console.info('\n🎉 Migrations complete!');
}

migrate();
