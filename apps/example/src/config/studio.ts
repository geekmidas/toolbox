import {
  Direction,
  InMemoryMonitoringStorage,
  Studio,
} from '@geekmidas/studio';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '../services/DatabaseService.js';
import { config } from './env.js';

/**
 * Studio instance for database browsing and monitoring.
 *
 * Studio provides:
 * - Database table browsing
 * - Row inspection and filtering
 * - Query monitoring (via Telescope integration)
 *
 * Access the dashboard at /__studio in your browser.
 */

// Create a Kysely instance for Studio
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: config.database.url }),
  }),
});

export const studio = new Studio<Database>({
  monitoring: {
    storage: new InMemoryMonitoringStorage({ maxEntries: 100 }),
  },
  data: {
    db,
    cursor: { field: 'id', direction: Direction.Desc },
  },
  enabled: process.env.NODE_ENV === 'development',
});
