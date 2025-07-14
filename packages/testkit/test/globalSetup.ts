import { Client } from 'pg';

const TEST_DATABASE_NAME = 'geekmidas_test';

export const TEST_DATABASE_CONFIG = {
  host: 'localhost',
  port: 5432,
  user: 'geekmidas',
  password: 'geekmidas',
  database: TEST_DATABASE_NAME,
};

export default async function globalSetup() {
  const adminConfig = {
    host: TEST_DATABASE_CONFIG.host,
    port: TEST_DATABASE_CONFIG.port,
    user: TEST_DATABASE_CONFIG.user,
    password: TEST_DATABASE_CONFIG.password,
    database: 'postgres', // Connect to default postgres database
  };

  const client = new Client(adminConfig);

  try {
    await client.connect();

    // Check if test database exists
    const result = await client.query(
      `SELECT * FROM pg_catalog.pg_database WHERE datname = $1`,
      [TEST_DATABASE_NAME],
    );

    // Create test database if it doesn't exist
    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    } else {
    }
  } finally {
    await client.end();
  }

  // Return cleanup function that drops the database
  return async () => {
    const cleanupClient = new Client(adminConfig);
    try {
      await cleanupClient.connect();
      await cleanupClient.query(
        `DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}"`,
      );
    } finally {
      await cleanupClient.end();
    }
  };
}
