import type { Knex } from 'knex';
import knex from 'knex';
import {
  CamelCasePlugin,
  type ControlledTransaction,
  Kysely,
  type Migrator,
  PostgresDialect,
  sql,
} from 'kysely';
import pg from 'pg';
import { TEST_DATABASE_CONFIG } from './globalSetup';

export interface TestDatabase {
  users: {
    id: number;
    name: string;
    email: string;
    role?: 'admin' | 'user';
    createdAt: Date;
    updatedAt?: Date;
  };
  posts: {
    id: number;
    title: string;
    content: string;
    userId: number;
    published?: boolean;
    createdAt: Date;
    updatedAt?: Date;
  };
  comments: {
    id: number;
    content: string;
    postId: number;
    userId: number;
    createdAt: Date;
  };
}

/**
 * Creates a Kysely database instance for testing
 */
export function createKyselyDb(): Kysely<TestDatabase> {
  return new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool(TEST_DATABASE_CONFIG),
    }),
    plugins: [new CamelCasePlugin()],
  });
}

/**
 * Creates a Knex database instance for testing
 */
export function createKnexDb(): Knex {
  return knex({
    client: 'pg',
    connection: TEST_DATABASE_CONFIG,
  });
}

/**
 * Test setup helper that creates tables within a transaction and returns cleanup
 */
export async function setupKyselyTest(db: Kysely<TestDatabase>): Promise<{
  db: Kysely<TestDatabase>;
  trx: ControlledTransaction<TestDatabase, []>;
  cleanup: () => Promise<void>;
}> {
  const trx = await db.startTransaction().execute();

  // Create tables within the transaction
  await createTestTables(db);

  const cleanup = async () => {
    await trx.rollback().execute();
    await db.destroy();
  };

  return { db, trx, cleanup };
}

/**
 * Test setup helper for Knex/Objection that creates tables within a transaction
 */
export async function setupKnexTest(): Promise<{
  db: Knex;
  trx: Knex.Transaction;
  cleanup: () => Promise<void>;
}> {
  const db = createKnexDb();
  const trx = await db.transaction();

  // Create tables within the transaction
  await createTestTablesKnex(trx);

  const cleanup = async () => {
    await trx.rollback();
    await db.destroy();
  };

  return { db, trx, cleanup };
}

/**
 * Creates test tables using Kysely
 */
export async function createTestTables(
  db: Kysely<TestDatabase> | ControlledTransaction<TestDatabase, []>,
): Promise<void> {
  // Create users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('email', 'varchar', (col) => col.notNull().unique())
    .addColumn('role', 'varchar', (col) => col.defaultTo('user'))
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  // Create posts table
  await db.schema
    .createTable('posts')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('title', 'varchar', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('user_id', 'bigint', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('published', 'boolean', (col) => col.defaultTo(false))
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  // Create comments table
  await db.schema
    .createTable('comments')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('post_id', 'bigint', (col) =>
      col.notNull().references('posts.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'bigint', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamp', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();
}

/**
 * Creates test tables using Knex
 */
async function createTestTablesKnex(trx: Knex.Transaction): Promise<void> {
  // Create users table
  await trx.schema.createTable('users', (table) => {
    table.bigIncrements('id').primary();
    table.string('name').notNullable();
    table.string('email').notNullable().unique();
    table.string('role').defaultTo('user');
    table.timestamp('created_at').defaultTo(trx.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(trx.fn.now()).notNullable();
  });

  // Create posts table
  await trx.schema.createTable('posts', (table) => {
    table.bigIncrements('id').primary();
    table.string('title').notNullable();
    table.text('content').notNullable();
    table
      .bigInteger('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('cascade');
    table.boolean('published').defaultTo(false);
    table.timestamp('created_at').defaultTo(trx.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(trx.fn.now()).notNullable();
  });

  // Create comments table
  await trx.schema.createTable('comments', (table) => {
    table.bigIncrements('id').primary();
    table.text('content').notNullable();
    table
      .bigInteger('post_id')
      .notNullable()
      .references('id')
      .inTable('posts')
      .onDelete('cascade');
    table
      .bigInteger('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('cascade');
    table.timestamp('created_at').defaultTo(trx.fn.now()).notNullable();
  });
}

/**
 * Helper for PostgresMigrator tests - creates a separate test database
 */
export async function createTestDatabase(
  dbName: string,
): Promise<() => Promise<void>> {
  const adminConfig = {
    host: TEST_DATABASE_CONFIG.host,
    port: TEST_DATABASE_CONFIG.port,
    user: TEST_DATABASE_CONFIG.user,
    password: TEST_DATABASE_CONFIG.password,
    database: 'postgres',
  };

  const client = new pg.Client(adminConfig);

  try {
    await client.connect();

    // Drop database if it exists, then create it
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }

  // Return cleanup function
  return async () => {
    const cleanupClient = new pg.Client(adminConfig);
    try {
      await cleanupClient.connect();
      await cleanupClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      await cleanupClient.end();
    }
  };
}

/**
 * Creates a Kysely migrator for testing
 */
export function createTestMigrator(
  db: Kysely<any>,
  migrations: Record<
    string,
    {
      up: (db: Kysely<any>) => Promise<void>;
      down: (db: Kysely<any>) => Promise<void>;
    }
  >,
): Migrator {
  const { Migrator } = require('kysely');

  return new Migrator({
    db,
    provider: {
      async getMigrations() {
        return migrations;
      },
    },
  });
}
