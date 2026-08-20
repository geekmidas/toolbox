import { BetterAuth } from '@geekmidas/constructs/auth';
import { magicLink } from 'better-auth/plugins';
import { database } from './database.js';
import { mail } from './email.js';

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
 *
 * Sign-in is a magic link and nothing else. There is no password to choose,
 * forget, reuse, or leak, and no hash worth stealing — which also means the
 * auth server has a hard dependency on being able to *send*: the link is the
 * credential, so mail is not a nicety here but the whole login path. That is
 * why the options are a function — it is handed the same registration options
 * the construct got, so the mail client comes from the construct that owns it
 * rather than from a transport configured a second time.
 */
export const auth = new BetterAuth('Auth', {
	database: authDb,
	basePath: '/api/auth',
	options: async (options) => {
		const mailer = await mail.service.register(options);

		return {
			plugins: [
				magicLink({
					sendMagicLink: async ({ email, url }) => {
						await mailer.sendTemplate('magicLink', {
							to: email,
							subject: 'Your sign-in link',
							props: { url },
						});
					},
				}),
			],
		};
	},
});
