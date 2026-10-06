import { UnauthorizedError } from '@geekmidas/errors';
import { z } from 'zod';
import { api } from '../../../constructs/api.js';

/**
 * The signed-in user, as the auth server says — asked over the compose
 * network, with the caller's cookie.
 */
export const me = api
	.session(async ({ auth }) => {
		const session = await auth.getSession();
		if (!session) throw new UnauthorizedError('Not signed in');
		return session;
	})
	.get('/me')
	.output(z.object({ email: z.string() }))
	.handle(async ({ session }) => ({ email: session.user.email }));
