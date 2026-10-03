import { users } from '@kitchen-sink/constructs/topics.js';
import { describe, expect } from 'vitest';
import { it } from '#test';
import { emailsQueue } from '../queues/emails.js';

const address = (who: string) => `${who}+${crypto.randomUUID()}@example.com`;

/**
 * The topic and the queue, end to end without a broker.
 *
 * What an endpoint publishes is recorded — `published` — and then delivered,
 * in-process, to the consumers that would receive it deployed: the queue's one
 * worker, and each subscriber that named the event. They run in this test's
 * transaction, so they see the rows the endpoint wrote. Turning a broker's
 * envelope into `{ type, payload }` is the adaptors' job and tested there; what
 * these tests hold is the contract — what a handler is handed.
 *
 * `queue(…).invoke()` remains for a consumer on its own: a redelivery, say.
 */
describe('publishing', () => {
	it('announces a created user on the topic, and enqueues their welcome', async ({
		browser,
		published,
	}) => {
		const email = address('ada');
		const user = await browser.api.post('/users', {
			body: { name: 'Ada', email },
		});

		expect(published(users)).toEqual([
			{
				type: 'user.created',
				payload: { userId: user.id, email, name: 'Ada' },
			},
		]);
		expect(published(emailsQueue)).toEqual([
			expect.objectContaining({
				payload: expect.objectContaining({ to: email, template: 'welcome' }),
			}),
		]);
	});

	it('announces a profile update, naming what changed', async ({
		browser,
		published,
	}) => {
		// The second event, which nothing used to publish.
		const email = address('ada');
		const user = await browser.api.post('/users', {
			body: { name: 'Ada', email },
		});
		await browser.signIn(email);

		await browser.api.patch('/me', { body: { name: 'Ada Lovelace' } });

		expect(published(users)).toContainEqual({
			type: 'user.updated',
			payload: { userId: user.id, changes: ['name'] },
		});
	});
});

describe('the subscriber', () => {
	it('writes each user a notification of their own', async ({
		browser,
		db,
	}) => {
		// End to end: the endpoints publish, and the test delivers what they
		// published to the subscriber in this test's transaction — no broker.
		const ada = await browser.api.post('/users', {
			body: { name: 'Ada', email: address('ada') },
		});
		const graceEmail = address('grace');
		const grace = await browser.api.post('/users', {
			body: { name: 'Grace', email: graceEmail },
		});
		await browser.signIn(graceEmail);
		await browser.api.patch('/me', { body: { name: 'Grace Hopper' } });

		const app = await db.get('database');
		const rows = await app
			.selectFrom('notifications')
			.select(['user_id', 'type', 'body'])
			.where('user_id', 'in', [ada.id, grace.id])
			.orderBy(['type', 'body'])
			.execute();
		expect(rows).toEqual([
			{ user_id: ada.id, type: 'user.created', body: 'Ada joined' },
			{ user_id: grace.id, type: 'user.created', body: 'Grace joined' },
			{
				user_id: grace.id,
				type: 'user.updated',
				body: 'Profile updated: name',
			},
		]);
	});
});

describe('the welcome worker', () => {
	it('sends the welcome mail, once per user', async ({ mailbox, queue }) => {
		const email = address('grace');
		const job = {
			to: email,
			name: 'Grace',
			userId: crypto.randomUUID(),
			template: 'welcome' as const,
		};

		// Twice, as a redelivery would: the second is deduplicated.
		await queue(emailsQueue).invoke({ messages: [job] });
		await queue(emailsQueue).invoke({ messages: [job] });

		const sent = await mailbox(email).all();
		expect(sent.map(({ subject }) => subject)).toEqual(['Welcome aboard']);
	});
});
