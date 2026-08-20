import { snifferContext } from '@geekmidas/constructs';
import {
	Direction,
	InMemoryMonitoringStorage,
	Studio,
} from '@geekmidas/studio';
import type { Database } from '../constructs/database.js';
import { database } from '../constructs/database.js';
import { envParser } from './env.js';

/**
 * Studio — database browsing and query monitoring at `/__studio`.
 *
 * The browser connects through the *construct*, not through a URL of its own:
 * one declaration, one client, so what you inspect here is by definition the
 * database the handlers write to. Resolving it needs the injected URL, which is
 * why this module lives outside the constructs glob — discovery imports what it
 * finds there before any URL exists.
 */
const db = await database.service.register({
	envParser,
	context: snifferContext,
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
