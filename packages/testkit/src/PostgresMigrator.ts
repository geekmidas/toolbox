import { Client } from 'pg';

async function setupClient(uri: string) {
  const url = new URL(uri);

  const db = new Client({
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: parseInt(url.port),
    database: 'postgres',
  });

  let database = url.pathname.slice(1);
  if (database.includes('?')) {
    database = database.substring(0, database.indexOf('?'));
  }
  return { database, db };
}

const logger = console;

export abstract class PostgresMigrator {
  constructor(private uri: string) {}

  abstract migrate(): Promise<void>;

  private static async create(
    uri: string,
  ): Promise<{ alreadyExisted: boolean }> {
    const { database, db } = await setupClient(uri);
    try {
      await db.connect();
      const result = await db.query(
        `SELECT * FROM pg_catalog.pg_database WHERE datname = '${database}'`,
      );

      if (result.rowCount === 0) {
        await db.query(`CREATE DATABASE "${database}"`);
      }

      return {
        alreadyExisted: result.rowCount ? result.rowCount > 0 : false,
      };
    } finally {
      await db.end();
    }
  }

  private static async drop(uri: string): Promise<void> {
    const { database, db } = await setupClient(uri);
    try {
      await db.connect();
      await db.query(`DROP DATABASE "${database}"`);
    } finally {
      await db.end();
    }
  }

  async start() {
    const { database, db } = await setupClient(this.uri);
    try {
      await PostgresMigrator.create(this.uri);
      // Implement migration logic here
      await this.migrate();
      logger.log(`Migrating database: ${database}`);
      // Example: await db.query('CREATE TABLE example (id SERIAL PRIMARY KEY)');
    } finally {
      await db.end();
    }

    return async () => {
      await PostgresMigrator.drop(this.uri);
    };
  }
}
