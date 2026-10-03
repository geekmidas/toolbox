import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { TestEndpointAdaptor } from '../endpoints/TestEndpointAdaptor';
import { publishConstructEvents } from '../publisher';
import { RestApi } from '../rest-api';
import { Topic } from '../topic/Topic';
import { recordingPublisher } from './__helpers__/recordingPublisher';

const tests = new Topic('Tests', {
	events: {
		'test.created': z.object({ id: z.string() }),
		'test.updated': z.object({ id: z.string(), changes: z.array(z.string()) }),
		'test.deleted': z.object({ id: z.string() }),
	},
});

const notifications = new Topic('Notifications', {
	events: {
		'notification.sent': z.object({ to: z.string() }),
	},
});

/**
 * Where an endpoint's events go is decided by the topic each `.event()` names
 * — there is no publisher slot to set on a surface, a branch or an endpoint.
 * These are the combinations that slot used to cover, asked of topics.
 */
describe('event topic combinations', () => {
	const mockLogger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(() => mockLogger),
	};

	const api = new RestApi('Test', {
		path: '.',
		defaultAuthorizer: 'none',
		logger: mockLogger,
	});

	const serviceDiscovery = new ServiceDiscovery(new EnvironmentParser({}));

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('.event(topic, …) on an endpoint', () => {
		it('should make the topic a dependency: its service and its id', () => {
			const endpoint = api
				.post('/test')
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '123' }));

			expect(endpoint.services.map((s) => s.serviceName)).toEqual(['tests']);
			expect(endpoint.services[0]).toBe(tests.service);
			// The manifest edge, as `.dependsOn([tests])` would record it.
			expect(endpoint.constructs).toEqual(['Tests']);
			expect(endpoint.events).toEqual([
				{
					topic: tests.service,
					type: 'test.created',
					payload: expect.any(Function),
				},
			]);
		});

		it('should require the topic publisher env var', async () => {
			const endpoint = api
				.post('/test')
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '123' }));

			expect(await endpoint.getEnvironment()).toContain(
				'TESTS_PUBLISHER_CONNECTION_STRING',
			);
		});

		it('should make services.<topic> available to the handler', async () => {
			const publisher = recordingPublisher();

			const endpoint = api
				.post('/test')
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async ({ services }) => {
					// An event the handler decides on itself, through the same
					// publisher the declared one goes through.
					await services.tests.publish([
						{ type: 'test.updated', payload: { id: '123', changes: ['x'] } },
					]);
					return { id: '123' };
				});

			await new TestEndpointAdaptor(endpoint).request({
				services: { tests: publisher },
				headers: { host: 'example.com' },
			});

			expect(publisher.published).toEqual([
				{ type: 'test.updated', payload: { id: '123', changes: ['x'] } },
				{ type: 'test.created', payload: { id: '123' } },
			]);
		});

		it('should add a topic named twice only once', () => {
			const endpoint = api
				.post('/test')
				.dependsOn([tests])
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.event(tests, {
					type: 'test.updated',
					payload: (response) => ({ id: response.id, changes: [] }),
				})
				.handle(async () => ({ id: '123' }));

			expect(endpoint.services.map((s) => s.serviceName)).toEqual(['tests']);
			expect(endpoint.constructs).toEqual(['Tests']);
			expect(endpoint.events.map((e) => e.type)).toEqual([
				'test.created',
				'test.updated',
			]);
		});

		it('should add each topic named, and keep each event bound to its own', () => {
			const endpoint = api
				.post('/test')
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.event(notifications, {
					type: 'notification.sent',
					payload: (response) => ({ to: response.id }),
				})
				.handle(async () => ({ id: '123' }));

			expect(endpoint.services.map((s) => s.serviceName)).toEqual([
				'tests',
				'notifications',
			]);
			expect(endpoint.constructs).toEqual(['Tests', 'Notifications']);
			expect(endpoint.events.map((e) => [e.topic, e.type])).toEqual([
				[tests.service, 'test.created'],
				[notifications.service, 'notification.sent'],
			]);
		});
	});

	describe('an endpoint built from a branch', () => {
		it('should keep its own events and topic dependency', () => {
			// A branch shares what a group needs; topics stay per endpoint.
			const branch = api.route('/api/v1');

			const endpoint = branch
				.post('/users')
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '123' }));

			const sibling = branch
				.post('/quiet')
				.output(z.object({ id: z.string() }))
				.handle(async () => ({ id: '123' }));

			expect(endpoint._path).toBe('/api/v1/users');
			expect(endpoint.services.map((s) => s.serviceName)).toEqual(['tests']);
			expect(endpoint.constructs).toEqual(['Tests']);
			expect(sibling.events).toEqual([]);
			expect(sibling.services).toEqual([]);
			expect(sibling.constructs).toEqual([]);
		});
	});

	describe('events through the builder chain', () => {
		it('should keep events declared before other builder methods', async () => {
			const publisher = recordingPublisher();

			const endpoint = api
				.post('/test')
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.description('Test endpoint')
				.tags(['test'])
				.handle(async () => ({ id: '123' }));

			await publishConstructEvents<any>(
				endpoint,
				{ id: '123' },
				serviceDiscovery,
				mockLogger,
				{ tests: publisher },
			);

			expect(publisher.published).toEqual([
				{ type: 'test.created', payload: { id: '123' } },
			]);
		});
	});

	describe('multiple endpoints', () => {
		it('should not leak events between endpoints built from one base', async () => {
			const publisher = recordingPublisher();
			const base = api.post('/test').output(z.object({ id: z.string() }));

			const created = base
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '1' }));

			const updated = base
				.event(tests, {
					type: 'test.updated',
					payload: (response) => ({ id: response.id, changes: ['name'] }),
				})
				.handle(async () => ({ id: '2' }));

			expect(created.events.map((e) => e.type)).toEqual(['test.created']);
			expect(updated.events.map((e) => e.type)).toEqual(['test.updated']);

			await publishConstructEvents<any>(
				created,
				{ id: '1' },
				serviceDiscovery,
				mockLogger,
				{ tests: publisher },
			);
			await publishConstructEvents<any>(
				updated,
				{ id: '2' },
				serviceDiscovery,
				mockLogger,
				{ tests: publisher },
			);

			expect(publisher.calls).toEqual([
				[{ type: 'test.created', payload: { id: '1' } }],
				[{ type: 'test.updated', payload: { id: '2', changes: ['name'] } }],
			]);
		});

		it('should send each endpoint to the topic it named', async () => {
			const testsPublisher = recordingPublisher();
			const notificationsPublisher = recordingPublisher();

			const endpoint1 = api
				.post('/test1')
				.output(z.object({ id: z.string() }))
				.event(tests, {
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '1' }));

			const endpoint2 = api
				.post('/test2')
				.output(z.object({ id: z.string() }))
				.event(notifications, {
					type: 'notification.sent',
					payload: (response) => ({ to: response.id }),
				})
				.handle(async () => ({ id: '2' }));

			const provided = {
				tests: testsPublisher,
				notifications: notificationsPublisher,
			};
			await publishConstructEvents<any>(
				endpoint1,
				{ id: '1' },
				serviceDiscovery,
				mockLogger,
				provided,
			);
			await publishConstructEvents<any>(
				endpoint2,
				{ id: '2' },
				serviceDiscovery,
				mockLogger,
				provided,
			);

			expect(testsPublisher.published).toEqual([
				{ type: 'test.created', payload: { id: '1' } },
			]);
			expect(notificationsPublisher.published).toEqual([
				{ type: 'notification.sent', payload: { to: '2' } },
			]);
		});
	});
});
