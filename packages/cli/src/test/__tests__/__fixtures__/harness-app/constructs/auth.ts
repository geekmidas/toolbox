import { BetterAuth } from '@geekmidas/constructs/auth';
import { magicLink } from 'better-auth/plugins';
import { authDatabase } from './database.js';

export const auth = new BetterAuth('Auth', {
	path: 'apps/auth',
	database: authDatabase,
	options: {
		// Paired in the harness with the client plugin of the same capability.
		plugins: [magicLink({ sendMagicLink: async () => {} })],
	},
});
