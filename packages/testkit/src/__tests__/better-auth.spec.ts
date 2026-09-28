import {
	authFlowTestSuite,
	caseInsensitiveTestSuite,
	normalTestSuite,
	testAdapter,
} from '@better-auth/test-utils/adapter';
import { betterAuth } from 'better-auth';
import { describe, expect, it } from 'vitest';
import { memoryAdapter } from '../better-auth';

/**
 * Conformance for `memoryAdapter`, against better-auth's own suites.
 *
 * better-auth 1.7 removed `runAdapterTest` from the main package and moved the
 * harness to `@better-auth/test-utils/adapter`. Borrowing it again beats
 * writing our own: the suites are what better-auth itself holds every adapter
 * to, so they move when its contract does — a hand-written copy would only
 * describe the contract as we understood it the day we wrote it.
 *
 * Joins, numeric ids and transactions are left out because `memoryAdapter`
 * declares support for none of them.
 */
// One store for the whole run: the harness asks for the adapter again each time
// it changes better-auth's options, and a fresh `memoryAdapter()` would start
// empty — writes to one Map, reads from another.
const store = new Map();

const { execute } = await testAdapter({
	adapter: () => memoryAdapter({}, store),
	// Nothing to migrate: every model is a Map, created on first write.
	runMigrations: () => {},
	tests: [normalTestSuite(), authFlowTestSuite(), caseInsensitiveTestSuite()],
	prefixTests: 'memoryAdapter',
});

execute();

/**
 * The path an application actually takes: sign up and sign in over HTTP, then
 * use the cookie the sign-in set to read the session back. The auth-flow suite
 * calls the API directly; this goes through `auth.handler` with real requests,
 * which is what a test of an app built on testkit does.
 */
describe('memoryAdapter behind a better-auth server', () => {
	const auth = betterAuth({
		baseURL: 'http://localhost:3000',
		secret: 'a-test-secret-that-is-long-enough-for-better-auth',
		database: memoryAdapter(),
		emailAndPassword: { enabled: true },
	});

	const post = (path: string, body: unknown, cookie?: string) =>
		auth.handler(
			new Request(`http://localhost:3000/api/auth${path}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					origin: 'http://localhost:3000',
					...(cookie ? { cookie } : {}),
				},
				body: JSON.stringify(body),
			}),
		);

	/** `name=value` pairs a browser would send back, from `set-cookie`. */
	const cookieFrom = (response: Response) =>
		response.headers
			.getSetCookie()
			.map((header) => header.split(';')[0])
			.join('; ');

	it('signs up, signs in, and resolves the session from the cookie', async () => {
		const signUp = await post('/sign-up/email', {
			email: 'ada@example.com',
			password: 'correct-horse-battery',
			name: 'Ada',
		});
		expect(signUp.status).toBe(200);

		const signIn = await post('/sign-in/email', {
			email: 'ada@example.com',
			password: 'correct-horse-battery',
		});
		expect(signIn.status).toBe(200);
		const cookie = cookieFrom(signIn);
		expect(cookie).toContain('better-auth.session_token=');

		const session = await auth.api.getSession({
			headers: new Headers({ cookie }),
		});
		expect(session?.user.email).toBe('ada@example.com');
		expect(session?.user.name).toBe('Ada');
	});

	it('resolves no session without the cookie, or after signing out', async () => {
		await post('/sign-up/email', {
			email: 'grace@example.com',
			password: 'correct-horse-battery',
			name: 'Grace',
		});
		const cookie = cookieFrom(
			await post('/sign-in/email', {
				email: 'grace@example.com',
				password: 'correct-horse-battery',
			}),
		);

		await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBe(
			null,
		);

		const signOut = await post('/sign-out', {}, cookie);
		expect(signOut.status).toBe(200);
		await expect(
			auth.api.getSession({ headers: new Headers({ cookie }) }),
		).resolves.toBe(null);
	});

	it('refuses a wrong password', async () => {
		await post('/sign-up/email', {
			email: 'alan@example.com',
			password: 'correct-horse-battery',
			name: 'Alan',
		});

		const signIn = await post('/sign-in/email', {
			email: 'alan@example.com',
			password: 'wrong-horse-battery',
		});
		expect(signIn.status).toBe(401);
	});
});
