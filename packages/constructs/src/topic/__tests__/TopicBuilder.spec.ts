import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { s } from '../../subscribers';
import { Topic } from '../Topic';
import { TopicBuilder } from '../TopicBuilder';

const events = {
	'user.created': z.object({ userId: z.string(), email: z.string() }),
	'user.updated': z.object({
		userId: z.string(),
		changes: z.array(z.string()),
	}),
};

describe('TopicBuilder', () => {
	it('builds a Topic from .topic().events()', () => {
		const topic = new TopicBuilder().topic('users').events(events);

		expect(Topic.isTopic(topic)).toBe(true);
		expect(topic.name).toBe('users');
		expect(topic.eventSchemas).toBe(events);
		expect(topic.eventTypes.sort()).toEqual(['user.created', 'user.updated']);
	});

	it('throws when the name is missing', () => {
		expect(() => new TopicBuilder().events(events)).toThrow(/name/);
	});

	it('resets builder state after events()', () => {
		const builder = new TopicBuilder();
		builder.topic('first').events(events);
		expect(() => builder.events(events)).toThrow(/name/);
	});
});

describe('Topic.publisher', () => {
	it('exposes a `<name>Publisher` producer service', () => {
		const topic = new TopicBuilder().topic('users').events(events);
		expect(topic.publisher.serviceName).toBe('usersPublisher');
	});

	it('requires the namespaced connection-string env var when injected', async () => {
		const topic = new TopicBuilder().topic('userEvents').events(events);

		// A construct that injects the publisher (a producer) requires its env var.
		const producer = s
			.services([topic.publisher])
			.subscribe('noop')
			.handle(async () => {});

		const env = await producer.getEnvironment();
		expect(env).toContain('USER_EVENTS_PUBLISHER_CONNECTION_STRING');
	});
});

describe('subscriber .topic() binding', () => {
	it('binds the topic name and does NOT require the publisher env (least privilege)', async () => {
		const topic = new TopicBuilder().topic('users').events(events);

		const subscriber = s
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
