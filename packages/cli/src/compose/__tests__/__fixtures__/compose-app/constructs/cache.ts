import type { Cache } from '@geekmidas/constructs/cache';
import { database } from './database.js';

/**
 * Declared from the database, as an app on a server target writes it. The
 * stack keeps it in its own Redis all the same.
 */
export const sessions: Cache<'Sessions'> = database.cache('Sessions');
