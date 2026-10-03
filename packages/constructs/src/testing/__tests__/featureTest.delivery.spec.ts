import { describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import { Worker } from '../../worker';
import {
	DeliveryDidNotSettle,
	DeliveryFailed,
	featureTest,
	MessageRejected,
} from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * What a test publishes reaches its consumers, in-process, as the broker would
 * route it — a queue's messages to its one consumer, a topic's events to each
 * subscriber that named them — after the consumer's schema has accepted them.
 */

const seen = {
	created: [] as unknown[],
	deleted: [] as unknown[],
	emails: [] as unknown[],
};

const users = new Topic('Users', {
	events: {
		'user.created': z.object({ id: z.string() }),
		'user.deleted': z.object({ id: z.string() }),
	},
});
const pings = new Topic('Pings', { events: { ping: z.object({}) } });

const worker = new Worker('Jobs');

const onCreated = worker
	.topic(users)
	.subscribe(['user.created'])
	.handle(async ({ events }) => {
		seen.created.push(...events);
	});
const onDeleted = worker
	.topic(users)
	.subscribe(['user.deleted'])
	.handle(async ({ events }) => {
		seen.deleted.push(...events);
	});
// Answers every ping with another: a loop that would never settle deployed.
const pingPong = worker
	.topic(pings)
	.subscribe(['ping'])
	.dependsOn([pings])
	.handle(async ({ services }) => {
		await services.pings.publish([{ type: 'ping', payload: {} }]);
	});

const emails = worker
	.queue('Emails')
	.message(z.object({ to: z.email() }))
	.handle(async ({ messages }) => {
		seen.emails.push(...messages);
	});
const broken = worker
	.queue('Broken')
	.message(z.object({}))
	.handle(async () => {
		throw new TypeError('the mail server is down');
	});

const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });

const createUser = api
	.post('/users')
	.body(z.object({ id: z.string() }))
	.output(z.object({ id: z.string() }))
	.event(users, {
		type: 'user.created',
		payload: (user) => ({ id: user.id }),
	})
	.handle(async ({ body }) => ({ id: body.id }));

const enqueue = api
	.post('/emails')
	.body(z.object({ to: z.string() }))
	.dependsOn([emails])
	.handle(async ({ body, services }) => {
		await services.emails.publish([{ type: 'Emails', payload: body }]);
		return {};
	});

const breakIt = api
	.post('/broken')
	.dependsOn([broken])
	.handle(async ({ services }) => {
		await services.broken.publish([{ type: 'Broken', payload: {} }]);
		return {};
	});

const ping = api
	.post('/ping')
	.dependsOn([pings])
	.handle(async ({ services }) => {
		await services.pings.publish([{ type: 'ping', payload: {} }]);
		return {};
	});

const source = (file: string, name: string) => ({ file, export: name });

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Users: { kind: 'topic', source: source('constructs', 'users') },
		Pings: { kind: 'topic', source: source('constructs', 'pings') },
		Emails: { kind: 'queue', source: source('constructs', 'emails') },
		Broken: { kind: 'queue', source: source('constructs', 'broken') },
	},
	endpoints: ['createUser', 'enqueue', 'breakIt', 'ping'].map((name) => ({
		surface: 'Api',
		source: source('endpoints', name),
	})),
	subscribers: ['onCreated', 'onDeleted', 'pingPong'].map((name) => ({
		source: source('subscribers', name),
	})),
	env: { API_URL: 'http://api.delivery.test' },
};

const it = featureTest({
	manifest,
	modules: {
		constructs: { users, pings, emails, broken },
		endpoints: { createUser, enqueue, breakIt, ping },
		subscribers: { onCreated, onDeleted, pingPong },
	},
});

const post = (path: string, body: unknown = {}) =>
	({
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
		url: `http://api.delivery.test${path}`,
	}) as const;

describe('featureTest delivery', () => {
	it('delivers a topic’s event to the subscribers that named it, and no other', async ({
		browser,
		published,
	}) => {
		seen.created.length = 0;
		seen.deleted.length = 0;
		const { url, ...init } = post('/users', { id: 'u-1' });

		await browser.fetch(url, init);

		// Recorded, as before…
		expect(published(users)).toEqual([
			{ type: 'user.created', payload: { id: 'u-1' } },
		]);
		// …and delivered by the time the response is back.
		expect(seen.created).toEqual([
			{ type: 'user.created', payload: { id: 'u-1' } },
		]);
		expect(seen.deleted).toEqual([]);
	});

	it('delivers a queue’s messages to its consumer', async ({ browser }) => {
		seen.emails.length = 0;
		const { url, ...init } = post('/emails', { to: 'ada@example.com' });

		await browser.fetch(url, init);

		expect(seen.emails).toEqual([{ to: 'ada@example.com' }]);
	});

	it('refuses what the consumer’s schema does not take', async ({
		browser,
	}) => {
		const { url, ...init } = post('/emails', { to: 'not an address' });

		await expect(browser.fetch(url, init)).rejects.toBeInstanceOf(
			MessageRejected,
		);
	});

	it('fails the test when a consumer throws', async ({ browser }) => {
		const { url, ...init } = post('/broken');

		const failure = await browser.fetch(url, init).catch((error) => error);

		expect(failure).toBeInstanceOf(DeliveryFailed);
		expect((failure as DeliveryFailed).consumer).toBe("queue 'Broken'");
		expect((failure as DeliveryFailed).cause).toBeInstanceOf(TypeError);
	});

	it('names consumers that never stop publishing to each other', async ({
		browser,
	}) => {
		const { url, ...init } = post('/ping');

		const failure = await browser.fetch(url, init).catch((error) => error);

		expect(failure).toBeInstanceOf(DeliveryDidNotSettle);
		expect((failure as DeliveryDidNotSettle).channels).toEqual(['Pings']);
	});
});
