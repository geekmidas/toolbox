import type { AuthSession } from '../auth';
import { identifyUser } from '../tracing';
import type { EndpointSurface, HeaderFn } from './Endpoint';

/**
 * The surface's authenticator, as a session callback sees it.
 *
 * Bound to the request being handled, so reading the session takes no
 * argument: `session(async ({ auth }) => auth.getSession())`.
 */
export interface SessionAuth {
	/** This request's session, verified by the `.auth()` construct — or `null`. */
	getSession(): Promise<AuthSession | null>;
}

/**
 * What is forwarded to the auth server: the headers a session travels in, and
 * whose request it is — nothing else.
 *
 * The client's address goes with the session because the auth server
 * rate-limits by it, `/get-session` included. Without it every user's session
 * check arrived from the surface itself — one shared bucket, so enough
 * traffic from anyone turned every session check into a 429 — and in tests,
 * concurrent tests queued on the same rate-limit row.
 */
const SESSION_HEADERS = ['cookie', 'authorization', 'x-forwarded-for'] as const;

/** `auth` for one request on one surface. */
export function sessionAuth(
	surface: EndpointSurface | undefined,
	header: HeaderFn,
): SessionAuth {
	return {
		async getSession() {
			const authenticator = surface?.auth;
			if (!surface || !authenticator) {
				throw new NoAuthenticator(surface?.id);
			}

			const headers = new Headers();
			for (const name of SESSION_HEADERS) {
				const value = header(name);
				if (value) headers.set(name, value);
			}

			const session = (await authenticator.verify(
				headers,
				surface.envParser,
			)) as AuthSession | null;

			// Whose request this is, from here on: its logger, its services and
			// its trace all say so. Read defensively: an authenticator other than
			// Better Auth answers in its own shape, and one without a user id
			// identifies no one.
			const identity = session as {
				user?: { id?: unknown };
				session?: { id?: unknown };
			} | null;
			if (typeof identity?.user?.id === 'string') {
				identifyUser({
					id: identity.user.id,
					...(typeof identity.session?.id === 'string'
						? { sessionId: identity.session.id }
						: {}),
				});
			}

			return session;
		},
	};
}

/** `auth.getSession()` was called on a surface that names no authenticator. */
export class NoAuthenticator extends Error {
	constructor(readonly surface: string | undefined) {
		super(
			`auth.getSession() needs an authenticator, and ${
				surface ? `the surface '${surface}'` : 'this endpoint'
			} declares none: declare one on the surface with .auth(construct).`,
		);
		this.name = 'NoAuthenticator';
	}
}
