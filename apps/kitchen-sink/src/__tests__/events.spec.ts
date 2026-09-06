import { describe, expect, it } from 'vitest';
import { eventually, getJson, patchJson, postJson } from './__helpers__/app.js';
import { messageTo } from './__helpers__/mailpit.js';
import { signIn } from './__helpers__/signIn.js';

interface User {
	id: string;
	email: string;
}

interface Notification {
	id: string;
	type: string;
	body: string;
}

const unique = (prefix: string) =>
	`${prefix}+${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;

/** Register, sign in, and be ready to read your own feed. */
async function member(prefix: string) {
	const email = unique(prefix);
	const created = await postJson<User>('/users', { name: 'Ada', email });
	const session = await signIn(email);

	return { email, id: created.body.id, cookie: session.cookie };
}

/**
 * The topic and the queue, driven through the application.
 *
 * These are the assertions the whole exercise is for. `POST /users` publishes
 * to a topic *and* enqueues on a queue in one request, and both are delivered
 * by whichever transport the project selected — pg-boss here, SNS and SQS on
 * the `sns` backend, with the same application code either way. Nothing below
 * mentions a broker, which is the property being tested as much as the delivery
 * is.
 *
 * Everything waits on an outcome rather than on a sleep: a subscriber and a
 * worker each run on their own clock, so the request that caused the work
 * returns before the work is done.
 */
describe('the topic fans out', () => {
	it('writes a notification for the user that was created', async () => {
		const ada = await member('ada');

		const notification = await eventually(async () => {
			const { body } = await getJson<{ notifications: Notification[] }>(
				'/notifications',
				{ headers: { cookie: ada.cookie } },
			);

			return body.notifications.find((n) => n.type === 'user.created');
		});

		expect(notification.body).toContain('joined');
	});

	it('delivers the second event too, which nothing used to publish', async () => {
		// `user.updated` has been in the topic's contract from the start with
		// nothing emitting it, so the subscriber's branch for it had never run. A
		// declared event nothing publishes is a contract that has never been
		// tested.
		const ada = await member('ada');

		await patchJson(
			'/me',
			{ name: 'Ada Lovelace' },
			{
				headers: { cookie: ada.cookie },
			},
		);

		const notification = await eventually(async () => {
			const { body } = await getJson<{ notifications: Notification[] }>(
				'/notifications',
				{ headers: { cookie: ada.cookie } },
			);

			return body.notifications.find((n) => n.type === 'user.updated');
		});

		expect(notification.body).toContain('name');
	});

	it('gives each user only their own notifications', async () => {
		// Fan-out is not broadcast: the subscriber keys each row to the user the
		// event was about, and the endpoint filters by the session.
		const ada = await member('ada');
		const grace = await member('grace');

		const mine = await eventually(async () => {
			const { body } = await getJson<{ notifications: Notification[] }>(
				'/notifications',
				{ headers: { cookie: grace.cookie } },
			);

			return body.notifications.length > 0 ? body.notifications : undefined;
		});

		expect(mine).toHaveLength(1);
		expect(ada.id).not.toBe(grace.id);
	});
});

describe('the queue drains', () => {
	it('sends the welcome mail the create enqueued', async () => {
		// Point-to-point, unlike the topic: one worker, every message. The mail
		// really arrives at a real SMTP server, which is the only assertion that
		// would fail if delivery broke — a mock would still say `send` was called.
		const email = unique('welcome');
		await postJson<User>('/users', { name: 'Grace', email });

		const message = await eventually(() => messageTo(email));

		expect(message.Subject).toBe('Welcome aboard');
	});

	it('does not send it twice for the same user', async () => {
		// The worker dedupes on a cache key, which is the cache doing work rather
		// than being demonstrated — and it is the app's own database holding it.
		const email = unique('once');
		await postJson<User>('/users', { name: 'Grace', email });

		await eventually(() => messageTo(email));
		await new Promise((r) => setTimeout(r, 1500));

		const { messages } = await import('./__helpers__/mailpit.js');
		const welcomes = (await messages()).filter(
			(m) =>
				m.Subject === 'Welcome aboard' &&
				m.To.some((to) => to.Address === email),
		);

		expect(welcomes).toHaveLength(1);
	});
});
