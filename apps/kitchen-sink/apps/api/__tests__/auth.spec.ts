import { describe, expect } from 'vitest';
import { it } from '#test';

/**
 * Magic-link sign-in, end to end, with the mail really sent.
 *
 * The link *is* the credential here — there is no password to get wrong — so
 * the auth server has a hard dependency on being able to send. That makes a
 * mocked mailer the one shortcut that would hide the failure it is most likely
 * to have: a login path that stops working because delivery broke, while every
 * test still passes.
 *
 * Every request goes where it goes deployed — the browser's clients to the
 * auth server and the API over their URLs, the mail over SMTP to Mailpit — and
 * every database is rolled back after each test.
 */

const address = (who: string) => `${who}+${crypto.randomUUID()}@example.com`;

describe('signing in with a magic link', () => {
	it('mails a link that produces a session', async ({ browser, mailbox }) => {
		const email = address('ada');

		await browser.auth.signIn.magicLink({ email });
		await browser.visit((await mailbox(email).last()).link!);

		const { data } = await browser.auth.getSession();
		expect(data?.user.email).toBe(email);
	});

	it('refuses a protected endpoint with no session', async ({ browser }) => {
		await expect(browser.api.get('/notifications')).rejects.toMatchObject({
			status: 401,
		});
	});

	it('refuses a protected endpoint with a junk cookie', async ({ browser }) => {
		await expect(
			browser.api.get('/notifications', {
				headers: { cookie: 'better-auth.session_token=not-a-real-token' },
			}),
		).rejects.toMatchObject({ status: 401 });
	});

	it('refuses a session whose address never registered', async ({
		browser,
		mailbox,
	}) => {
		// A real state rather than an impossible one: anyone can ask for a magic
		// link for any address, and holding one proves the address and nothing
		// else. 403 rather than 401 — the credential is fine, the account is what
		// is missing.
		const email = address('stranger');
		await browser.auth.signIn.magicLink({ email });
		await browser.visit((await mailbox(email).last()).link!);

		await expect(browser.api.get('/notifications')).rejects.toMatchObject({
			status: 403,
		});
	});

	it('allows it with a real one, once the address has a profile', async ({
		browser,
		mailbox,
	}) => {
		// Two identities meet here: Better Auth's user, in its own schema tenant,
		// and `app.users`. Email joins them, because it is the one fact both hold
		// and the one the link proved.
		const email = address('grace');
		await browser.api.post('/users', { body: { name: 'Grace', email } });

		await browser.auth.signIn.magicLink({ email });
		await browser.visit((await mailbox(email).last()).link!);

		expect(await browser.api.get('/notifications')).toEqual({
			notifications: [],
		});
	});
});
