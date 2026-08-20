import { BetterAuth } from '@geekmidas/constructs/auth';
import { database } from './database.js';

/**
 * The auth database — a schema tenant of the app's own database.
 *
 * Its tables live in the `authdb` schema with their own role, so the
 * application's role holds no grant on them at all: a compromised handler
 * cannot read sessions. It is a second URL in the same Postgres, not a second
 * database, and both are derived.
 */
export const authDb = database.schema<Record<string, never>, 'AuthDb'>(
	'AuthDb',
);

/**
 * The auth server.
 *
 * Three things at once — a consumer of a database, a producer of an authorizer,
 * and a set of endpoints. The first is the tenant above; the second and third
 * wait on the `rest-api` kind, so for now the routes are mounted by the server
 * hook in `src/config/hooks.ts` and `.authorizer('iam')` is unchanged.
 *
 * `AUTH_SECRET` is declared by this construct and derived by the target — the
 * one secret in the app, and it is not in any file.
 */
export const auth = new BetterAuth('Auth', {
	database: authDb,
	basePath: '/api/auth',
	options: {
		emailAndPassword: { enabled: true },
	},
});
