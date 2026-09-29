import { BetterAuth } from '@geekmidas/constructs/auth';
import { authDatabase } from './database.js';

/** Its routes are a wildcard it mounts itself, so no glob finds them. */
export const auth = new BetterAuth('Auth', {
	path: 'apps/auth',
	database: authDatabase,
	options: { emailAndPassword: { enabled: true } },
});
