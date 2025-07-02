import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

import {
  CamelCasePlugin,
  FileMigrationProvider,
  Kysely,
  PostgresDialect,
} from 'kysely';

import { PostgresKyselyMigrator } from '../src/PostgresKyselyMigrator';

const TEST_DATABASE_NAME = 'geekmidas_test';

const logger = console;

export const TEST_DATABASE_CONFIG = {
  host: 'localhost',
  port: 5432,
  user: 'geekmidas',
  password: 'geekmidas',
  database: TEST_DATABASE_NAME,
};

// password: get('Database.password').string(),
//       user: get('Database.username').string(),
//       database: get('Database.database').string(),
//       host: get('Database.host').string(),
//       port: get('Database.port').number().default(5432),

export default async function globalSetup() {
  const uri = `postgres://${TEST_DATABASE_CONFIG.user}:${TEST_DATABASE_CONFIG.password}@${TEST_DATABASE_CONFIG.host}:${TEST_DATABASE_CONFIG.port}/${TEST_DATABASE_CONFIG.database}`;

  const migrationFolder = path.resolve(__dirname, './migrations');

  const migrationProcessor = new PostgresKyselyMigrator({
    uri,
    db: new Kysely({
      dialect: new PostgresDialect({
        pool: new pg.Pool(TEST_DATABASE_CONFIG),
      }),
      plugins: [new CamelCasePlugin()],
    }),
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  });

  return migrationProcessor.start();
}
