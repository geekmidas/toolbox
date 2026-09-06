import { beforeAll, describe, expect, it } from 'vitest';
import { getJson, harness, postJson } from './__helpers__/app.js';
import { clearInbox } from './__helpers__/mailpit.js';
import { signIn } from './__helpers__/signIn.js';

/**
 * Magic-link sign-in, end to end, with the mail really sent.
 *
 * The link *is* the credential here — there is no password to get wrong — so
 * the auth server has a hard dependency on being able to send. That makes a
 * mocked mailer the one shortcut that would hide the failure it is most likely
 * to have: a login path that stops working because delivery broke, while every
 * test still passes.
 */
describe('signing in with a magic link', () => {
	const email = `ada+${Date.now()}@example.com`;

	beforeAll(async () => {
		await clearInbox();
	});

	it('mails a link that produces a session', async () => {
		const session = await signIn(email);

		expect(session.userId).toBeTruthy();
		expect(session.cookie).toContain('=');
	});

	it('is the same session the app reads on a later request', async () => {
		// Two different readers of one cookie: Better Auth's own route, and the
		// app's endpoints through `requireUser`. A session only one of them can
		// see is the shape of bug that shows up as an endpoint that logs you out.
		const session = await signIn(email);
		const { status, body } = await getJson<{ user: { email: string } }>(
			'/api/auth/get-session',
			{ headers: { cookie: session.cookie } },
		);

		expect(status).toBe(200);
		expect(body.user.email).toBe(email);
	});

	it('refuses a protected endpoint with no session', async () => {
		// This is the assertion the endpoint failed before: it called
		// `getSession`, ignored the answer, and served the row anyway.
		const { status } = await getJson('/notifications');

		expect(status).toBe(401);
	});

	it('refuses a protected endpoint with a junk cookie', async () => {
		const { status } = await getJson('/notifications', {
			headers: { cookie: 'better-auth.session_token=not-a-real-token' },
		});

		expect(status).toBe(401);
	});

	it('refuses a session whose address never registered', async () => {
		// A real state rather than an impossible one: anyone can ask for a magic
		// link for any address, and holding one proves the address and nothing
		// else. 403 rather than 401 — the credential is fine, the account is what
		// is missing, and answering 401 would send a client back to sign in
		// again, which would succeed and change nothing.
		const stranger = `stranger+${Date.now()}@example.com`;
		const session = await signIn(stranger);

		const { status } = await getJson('/notifications', {
			headers: { cookie: session.cookie },
		});

		expect(status).toBe(403);
	});

	it('allows it with a real one, once the address has a profile', async () => {
		// Two identities meet here: Better Auth's user, in its own schema tenant
		// with its own id format, and `app.users`, whose id is a uuid the auth
		// tenant holds no grant to read. Email is what joins them, because it is
		// the one fact both hold and the one the link proved.
		const registered = `registered+${Date.now()}@example.com`;
		await postJson('/users', { name: 'Grace', email: registered });

		const session = await signIn(registered);
		const { status } = await getJson('/notifications', {
			headers: { cookie: session.cookie },
		});

		expect(status).toBe(200);
	});

	it('serves the auth routes from the surface the app declared', async () => {
		// The routes are mounted by the server hook at the construct's own
		// `basePath`, not at a path written twice.
		const { request } = await harness();

		expect((await request('/api/auth/get-session')).status).toBe(200);
	});
});
