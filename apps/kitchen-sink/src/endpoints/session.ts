import { ForbiddenError, UnauthorizedError } from '@geekmidas/errors';
import type { Kysely } from 'kysely';
import type { Database } from '../constructs/database.js';

/** The signed-in user, as the *application* knows them. */
export interface SessionUser {
	id: string;
	name: string;
	email: string;
}

/**
 * What `requireUser` needs from an endpoint's context, and nothing more.
 *
 * Structural rather than the factory's own context type: this reads the auth
 * server, one header and the database, so saying that is both the accurate
 * signature and the one that keeps working as the router gains services.
 */
interface SessionContext {
	services: {
		auth: {
			api: {
				getSession(input: { headers: Headers }): Promise<{
					user?: { id: string; email: string };
				} | null>;
			};
		};
	};
	header(name: string): string | undefined;
	db: Kysely<Database>;
}

/**
 * The signed-in application user, or a 401.
 *
 * Two identities meet here, and keeping them straight is the whole job.
 * Better Auth owns credentials and sessions in its own schema tenant, with its
 * own `user` table and its own id format; the application owns `app.users`,
 * whose id is a uuid and whose rows the auth tenant holds no grant on. They are
 * deliberately separate — that separation is what stops a compromised handler
 * reading sessions — so nothing joins them for free.
 *
 * Email is what joins them, because it is the one fact both tables hold and the
 * one the magic link proved. Resolving it here rather than in each endpoint is
 * what stops an endpoint reaching for `session.user.id` and querying `app.users`
 * with an id from the other namespace: that compares a nanoid against a `uuid`
 * column, which is not a wrong answer but a 500.
 *
 * It exists at all because the endpoint that called `getSession` *ignored the
 * result*: it was protected in the sense that it asked, and unprotected in the
 * sense that any answer did. `.authorizer('iam')` is the deployed half of the
 * same story and enforces nothing locally, which is exactly the arrangement
 * where a gap goes unnoticed — guarded-looking on both paths, guarded on
 * neither.
 */
export async function requireUser(ctx: SessionContext): Promise<SessionUser> {
	const session = await ctx.services.auth.api.getSession({
		headers: new Headers({ cookie: ctx.header('cookie') ?? '' }),
	});

	if (!session?.user) throw new UnauthorizedError('Not signed in');

	const user = await ctx.db
		.selectFrom('users')
		.selectAll()
		.where('email', '=', session.user.email)
		.executeTakeFirst();

	// Signed in, and no profile — a real state rather than an impossible one:
	// anyone can request a magic link for an address that never registered.
	// 403 rather than 401, because the credential is fine and the account is
	// what is missing; answering 401 would send a client back to sign in again,
	// which would succeed and change nothing.
	if (!user) {
		throw new ForbiddenError(
			`Signed in as ${session.user.email}, which has no profile. POST /users first.`,
		);
	}

	return { id: user.id, name: user.name, email: user.email };
}
