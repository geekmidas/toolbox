import { BetterAuth } from '@geekmidas/constructs/auth';
import { authDatabase } from './database.js';
import { telemetry } from './telemetry.js';

/** Its own container: its routes are a wildcard it mounts itself. */
export const auth = new BetterAuth('Auth', {
	path: 'apps/auth',
	database: authDatabase,
	options: { emailAndPassword: { enabled: true } },
	telemetry,
});
