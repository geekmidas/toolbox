import type { AuthSession } from '../auth';
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

/** The headers a session travels in; nothing else is forwarded. */
const SESSION_HEADERS = ['cookie', 'authorization'] as const;

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

			return (await authenticator.verify(
				headers,
				surface.envParser,
			)) as AuthSession | null;
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
