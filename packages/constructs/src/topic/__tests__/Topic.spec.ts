import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Worker } from '../../worker';
import { Topic } from '../Topic';

const events = {
	'user.created': z.object({ userId: z.string(), email: z.string() }),
	'user.updated': z.object({
		userId: z.string(),
		changes: z.array(z.string()),
	}),
};

/** Everything runnable is built from the process that runs it. */
const testWorker = new Worker('Jobs');

describe('new Topic', () => {
	it('declares its events and keeps its name for the broker', () => {
		const topic = new Topic('users', { events });

		expect(Topic.isTopic(topic)).toBe(true);
		expect(topic.name).toBe('users');
		expect(topic.eventSchemas).toBe(events);
		expect(topic.eventTypes.sort()).toEqual(['user.created', 'user.updated']);
	});
});

describe('Topic.declare', () => {
	it('declares a topic under a canonical id', () => {
		// `users` and `Users` are one topic, not two that collide — and the name
		// is left alone, because subscribers bind to it and the broker routes on
		// it.
		const topic = new Topic('users', { events });

		expect(topic.id).toBe('Users');
		expect(topic.name).toBe('users');
		expect(topic.declare()).toEqual([
			{
				kind: 'topic',
				id: 'Users',
				provides: ['USERS_PUBLISHER_CONNECTION_STRING'],
				// The contract it carries. Structural, so a subscriber binding to
				// an event this topic does not have is catchable at build.
				events: Object.keys(events),
				// Bound rather than declared here — a subscriber names the topic,
				// not the other way round — so the build fills these in.
				subscribers: [],
			},
		]);
	});

	it('declares the key its own publisher reads', () => {
		// Declared once: what the target publishes and what the producer looks up
		// cannot drift.
		const topic = new Topic('userEvents', { events });
		const [declaration] = topic.declare();

		expect(declaration?.provides).toEqual([
			'USER_EVENTS_PUBLISHER_CONNECTION_STRING',
		]);
	});
});

describe('Topic.service', () => {
	it('is the producer, keyed by the topic — services.users', () => {
		const topic = new Topic('users', { events });

		expect(topic.service.serviceName).toBe('users');
		// One object for the topic's life: services are cached by identity.
		expect(topic.service).toBe(topic.service);
	});

	it('requires the namespaced connection-string env var where it is depended on', async () => {
		const topic = new Topic('userEvents', { events });

		const producer = testWorker.dependsOn([topic]).handle(async () => ({}));

		const env = await producer.getEnvironment();
		expect(env).toContain('USER_EVENTS_PUBLISHER_CONNECTION_STRING');
	});
});

describe('subscriber .topic() binding', () => {
	it('binds the topic name and does NOT require the publisher env (least privilege)', async () => {
		const topic = new Topic('users', { events });

		const subscriber = testWorker
			.topic(topic)
			.subscribe(['user.created', 'user.updated'])
			.handle(async ({ events }) => {
				// payloads are typed from the topic contract
				for (const event of events) {
					if (event.type === 'user.created') {
						void event.payload.email;
					}
				}
			});

		expect(subscriber.topicName).toBe('users');
		expect(subscriber.subscribedEvents).toEqual([
			'user.created',
			'user.updated',
		]);

		// A consumer does not publish, so binding a topic requires no publisher env.
		const env = await subscriber.getEnvironment();
		expect(env).not.toContain('USERS_PUBLISHER_CONNECTION_STRING');
	});
});
