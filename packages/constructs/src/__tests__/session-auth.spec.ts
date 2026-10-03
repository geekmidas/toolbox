import { UnauthorizedError } from '@geekmidas/errors';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Authenticator } from '../construct-interface';
import { NoAuthenticator } from '../endpoints';
import { TestEndpointAdaptor } from '../endpoints/TestEndpointAdaptor';
import { RestApi } from '../rest-api';

/**
 * `session({ auth })`: the surface's authenticator, bound to the request, is
 * what a session callback reads the session from. What the authenticator does
 * with the headers is its own business — `BetterAuth.verify` is tested against
 * a real server in `auth.spec.ts` — so this one records what it was asked.
 */
function authenticator() {
	const asked: Headers[] = [];
	const construct: Authenticator = {
		id: 'Auth',
		declare: () => [
			{ kind: 'rest-api', id: 'Auth', path: 'apps/auth', endpoints: [] },
		],
		async verify(headers) {
			asked.push(headers);
			return headers.get('cookie') === 'session=ada'
				? {
						user: { id: 'u1', email: 'ada@shop.test', name: 'Ada' },
						session: { id: 's1', userId: 'u1' },
					}
				: null;
		},
	};
	return { construct, asked };
}

const surface = (auth?: Authenticator) => {
	const api = new RestApi('Api', {
		path: 'apps/api',
		defaultAuthorizer: 'none',
	});
	return auth ? api.auth(auth) : api;
};

const signedIn = (api: ReturnType<typeof surface>) =>
	api.session(async ({ auth }) => {
		const session = await auth.getSession();
		if (!session) throw new UnauthorizedError('No active session');
		return session;
	});

describe('session({ auth })', () => {
	it('reads the session from the surface’s authenticator', async () => {
		const { construct } = authenticator();
		const me = signedIn(surface(construct))
			.get('/me')
			.output(z.object({ email: z.string() }))
			.handle(async ({ session }) => ({ email: session.user.email }));

		const result = await new TestEndpointAdaptor(me).request({
			services: {},
			headers: { cookie: 'session=ada' },
		});

		expect(result).toEqual({ email: 'ada@shop.test' });
	});

	it('lets the callback refuse a request with no session', async () => {
		const { construct } = authenticator();
		const me = signedIn(surface(construct))
			.get('/me')
			.handle(async () => ({}));

		await expect(
			new TestEndpointAdaptor(me).request({ services: {}, headers: {} }),
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('forwards the session headers and whose request it is, nothing else', async () => {
		const { construct, asked } = authenticator();
		const me = signedIn(surface(construct))
			.get('/me')
			.handle(async () => ({}));

		await new TestEndpointAdaptor(me).request({
			services: {},
			headers: {
				cookie: 'session=ada',
				authorization: 'Bearer t',
				'x-forwarded-for': '10.0.0.1',
				'x-request-id': 'r-1',
			},
		});

		// The client's address too: the auth server rate-limits `/get-session`
		// by it, and without it every user's session check shared one bucket.
		expect(Object.fromEntries(asked[0]!)).toEqual({
			cookie: 'session=ada',
			authorization: 'Bearer t',
			'x-forwarded-for': '10.0.0.1',
		});
	});

	it('asks nothing of the authenticator for a route that reads no session', async () => {
		const { construct, asked } = authenticator();
		const health = surface(construct)
			.get('/health')
			.handle(async () => ({}));

		await new TestEndpointAdaptor(health).request({
			services: {},
			headers: { cookie: 'session=ada' },
		});

		expect(asked).toHaveLength(0);
	});

	it('says what to do when the surface names no authenticator', async () => {
		const me = signedIn(surface())
			.get('/me')
			.handle(async () => ({}));

		await expect(
			new TestEndpointAdaptor(me).request({
				services: {},
				headers: { cookie: 'session=ada' },
			}),
		).rejects.toBeInstanceOf(NoAuthenticator);
	});

	it('declares the authenticator by id', () => {
		const { construct } = authenticator();

		expect(surface(construct).declare()[0]).toMatchObject({ auth: 'Auth' });
	});
});
