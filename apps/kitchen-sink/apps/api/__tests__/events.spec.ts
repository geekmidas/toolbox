import { users } from '@kitchen-sink/constructs/topics.js';
import { describe, expect } from 'vitest';
import { it } from '#test';
import { emailsQueue } from '../queues/emails.js';
import { userEventsSubscriber } from '../subscribers/userEvents.js';
import { signIn } from './__helpers__/signIn.js';

const address = (who: string) => `${who}+${crypto.randomUUID()}@example.com`;

/**
 * The topic and the queue, each tested at its own end.
 *
 * Delivery is the broker's job — pg-boss here, SNS and SQS deployed — and not
 * the application's, so no test here waits on one. What the application owns
 * is what it *publishes* and what its handlers *do* with what they are handed,
 * and each is checked directly: the endpoint's publishing through `published`,
 * the subscriber and the worker by handing them events.
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
		mailbox,
		published,
	}) => {
		// The second event, which nothing used to publish.
		const email = address('ada');
		const user = await browser.api.post('/users', {
			body: { name: 'Ada', email },
		});
		await signIn({ browser, mailbox }, email);

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
		subscriber,
	}) => {
		const ada = await browser.api.post('/users', {
			body: { name: 'Ada', email: address('ada') },
		});
		const grace = await browser.api.post('/users', {
			body: { name: 'Grace', email: address('grace') },
		});

		await subscriber(userEventsSubscriber).invoke({
			events: [
				{
					type: 'user.created',
					payload: { userId: ada.id, email: ada.email, name: 'Ada' },
				},
				{
					type: 'user.updated',
					payload: { userId: grace.id, changes: ['name'] },
				},
			],
		});

		const rows = await db.database
			.selectFrom('notifications')
			.select(['user_id', 'type', 'body'])
			.where('user_id', 'in', [ada.id, grace.id])
			.orderBy('type')
			.execute();
		expect(rows).toEqual([
			{ user_id: ada.id, type: 'user.created', body: 'Ada joined' },
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
