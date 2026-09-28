import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAILPIT_URL } from '../../test/ports';
import { ensureServices } from '../../test/services';
import { createMailbox, NoMail } from '../mailbox';

/**
 * A real Mailpit. Mail is put in through its own send API — the same inbox an
 * app's SMTP delivers to — and read back the way a test reads it.
 */
beforeAll(() => ensureServices('mailpit'), 120_000);

const mailbox = createMailbox({ inbox: MAILPIT_URL, timeout: 1_000 });

/** A unique recipient per test: Mailpit has one inbox, and no transactions. */
const address = () => `user-${randomUUID()}@shop.test`;

const send = async (
	to: string,
	message: { subject: string; text?: string; html?: string },
) => {
	const response = await fetch(`${MAILPIT_URL}/api/v1/send`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			From: { Email: 'noreply@shop.test' },
			To: [{ Email: to }],
			Subject: message.subject,
			Text: message.text ?? '',
			HTML: message.html ?? '',
		}),
	});
	expect(response.ok).toBe(true);
};

describe('mailbox', () => {
	it('reads the newest email to an address, with its links', async () => {
		const to = address();
		await send(to, { subject: 'Welcome', text: 'Hello' });
		await send(to, {
			subject: 'Sign in',
			html: '<a href="https://auth.shop.localhost/api/auth/magic-link/verify?token=abc&amp;callbackURL=%2F">Sign in</a>',
		});

		const email = await mailbox(to).last();

		expect(email).toMatchObject({
			subject: 'Sign in',
			to: [to],
			from: 'noreply@shop.test',
			link: 'https://auth.shop.localhost/api/auth/magic-link/verify?token=abc&callbackURL=%2F',
		});
	});

	it('waits for mail still on its way', async () => {
		const to = address();
		setTimeout(() => void send(to, { subject: 'Late' }), 200);

		expect((await mailbox(to).last()).subject).toBe('Late');
	});

	it('says so when nothing arrives', async () => {
		await expect(mailbox(address()).last()).rejects.toBeInstanceOf(NoMail);
	});

	it('keeps to its own address, and clears only that', async () => {
		const ada = address();
		const bob = address();
		await send(ada, { subject: 'For Ada' });
		await send(bob, { subject: 'For Bob' });

		expect((await mailbox(ada).all()).map((e) => e.subject)).toEqual([
			'For Ada',
		]);

		await mailbox(ada).clear();

		expect(await mailbox(ada).all()).toEqual([]);
		expect((await mailbox(bob).all()).map((e) => e.subject)).toEqual([
			'For Bob',
		]);
	});
});
