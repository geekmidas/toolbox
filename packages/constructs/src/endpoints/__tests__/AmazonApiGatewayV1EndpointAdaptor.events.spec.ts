import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import {
	createMockContext,
	createMockV1Event as createMockEvent,
} from '@geekmidas/testkit/aws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { recordTopic } from '../../__tests__/__helpers__/recordingPublisher';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import { AmazonApiGatewayV1Endpoint } from '../AmazonApiGatewayV1EndpointAdaptor';

const users = new Topic('Users', {
	events: {
		'user.created': z.object({ userId: z.string(), email: z.string() }),
		'user.updated': z.object({
			userId: z.string(),
			changes: z.array(z.string()),
		}),
	},
});

const notifications = new Topic('Notifications', {
	events: {
		'notification.sent': z.object({ userId: z.string(), type: z.string() }),
	},
});

class DatabaseConnectionFailed extends Error {
	constructor() {
		super('Database connection failed');
		this.name = 'DatabaseConnectionFailed';
	}
}

const createMockLogger = (): Logger => {
	const logger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(() => logger),
	};
	return logger;
};

const v1Event = (
	method: string,
	path: string,
	overrides: Parameters<typeof createMockEvent>[0] = {},
) =>
	createMockEvent({
		httpMethod: method,
		path,
		body: JSON.stringify({}),
		...overrides,
	});

describe('AmazonApiGatewayV1Endpoint Events', () => {
	let mockLogger: Logger;
	let api: RestApi<'Test'>;

	beforeEach(() => {
		mockLogger = createMockLogger();
		api = new RestApi('Test', {
			path: '.',
			defaultAuthorizer: 'none',
			logger: mockLogger,
		});
		// Each test registers its topic's publisher afresh.
		ServiceDiscovery.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should publish events after successful endpoint execution', async () => {
		const publisher = recordTopic(users);

		const endpoint = api
			.post('/users')
			.output(z.object({ id: z.string(), email: z.string() }))
			.event(users, {
				type: 'user.created',
				payload: (response) => ({ userId: response.id, email: response.email }),
			})
			.handle(async () => ({ id: '123', email: 'test@example.com' }));

		const handler = new AmazonApiGatewayV1Endpoint(endpoint).handler;
		const response = await handler(
			v1Event('POST', '/users'),
			createMockContext(),
		);

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe(
			JSON.stringify({ id: '123', email: 'test@example.com' }),
		);
		expect(publisher.calls).toEqual([
			[
				{
					type: 'user.created',
					payload: { userId: '123', email: 'test@example.com' },
				},
			],
		]);
	});

	it('should publish events to two topics, each through its own publisher', async () => {
		const usersPublisher = recordTopic(users);
		const notificationsPublisher = recordTopic(notifications);

		const endpoint = api
			.post('/users')
			.status(201)
			.output(z.object({ id: z.string(), email: z.string() }))
			.event(users, {
				type: 'user.created',
				payload: (response) => ({ userId: response.id, email: response.email }),
			})
			.event(notifications, {
				type: 'notification.sent',
				payload: (response) => ({ userId: response.id, type: 'welcome' }),
			})
			.handle(async () => ({ id: '456', email: 'user@example.com' }));

		const handler = new AmazonApiGatewayV1Endpoint(endpoint).handler;
		const response = await handler(
			v1Event('POST', '/users'),
			createMockContext(),
		);

		expect(response.statusCode).toBe(201);
		expect(usersPublisher.calls).toEqual([
			[
				{
					type: 'user.created',
					payload: { userId: '456', email: 'user@example.com' },
				},
			],
		]);
		expect(notificationsPublisher.calls).toEqual([
			[
				{
					type: 'notification.sent',
					payload: { userId: '456', type: 'welcome' },
				},
			],
		]);
	});

	it('should respect when conditions for events', async () => {
		const publisher = recordTopic(users);

		const endpoint = api
			.put('/users/:id')
			.output(
				z.object({ id: z.string(), email: z.string(), isNew: z.boolean() }),
			)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({ userId: response.id, email: response.email }),
				when: (response) => response.isNew === true,
			})
			.event(users, {
				type: 'user.updated',
				payload: (response) => ({ userId: response.id, changes: ['email'] }),
				when: (response) => response.isNew === false,
			})
			.handle(async () => ({
				id: '789',
				email: 'updated@example.com',
				isNew: false,
			}));

		const handler = new AmazonApiGatewayV1Endpoint(endpoint).handler;
		const response = await handler(
			v1Event('PUT', '/users/789', { pathParameters: { id: '789' } }),
			createMockContext(),
		);

		expect(response.statusCode).toBe(200);
		// Only user.updated event should be published due to when condition
		expect(publisher.published).toEqual([
			{
				type: 'user.updated',
				payload: { userId: '789', changes: ['email'] },
			},
		]);
	});

	it('should not run the handler when the topic publisher cannot be registered', async () => {
		// `.event(users, …)` makes the topic a dependency, as `.dependsOn` would:
		// with no USERS_PUBLISHER_CONNECTION_STRING the handler's services cannot
		// be built, so it never runs — no write whose event would be lost.
		const handle = vi.fn(async () => ({
			id: '999',
			email: 'test@example.com',
		}));

		const endpoint = api
			.post('/users')
			.output(z.object({ id: z.string(), email: z.string() }))
			.event(users, {
				type: 'user.created',
				payload: (response) => ({ userId: response.id, email: response.email }),
			})
			.handle(handle);

		const handler = new AmazonApiGatewayV1Endpoint(endpoint).handler;
		const response = await handler(
			v1Event('POST', '/users'),
			createMockContext(),
		);

		expect(response.statusCode).toBe(500);
		expect(response.body).toContain('USERS_PUBLISHER_CONNECTION_STRING');
		expect(handle).not.toHaveBeenCalled();
	});

	it('should not publish events when no events are configured', async () => {
		const publisher = recordTopic(users);

		const endpoint = api
			.post('/users')
			.dependsOn([users])
			.output(z.object({ id: z.string(), email: z.string() }))
			.handle(async () => ({ id: '111', email: 'test@example.com' }));

		const handler = new AmazonApiGatewayV1Endpoint(endpoint).handler;
		const response = await handler(
			v1Event('POST', '/users'),
			createMockContext(),
		);

		expect(response.statusCode).toBe(200);
		expect(publisher.calls).toEqual([]);
	});

	it('should continue processing even when event publishing fails', async () => {
		const publishError = new Error('Event bus connection failed');
		const publisher = recordTopic(users);
		vi.spyOn(publisher, 'publish').mockRejectedValue(publishError);

		const endpoint = api
			.post('/users')
			.output(z.object({ id: z.string(), email: z.string() }))
			.event(users, {
				type: 'user.created',
				payload: (response) => ({ userId: response.id, email: response.email }),
			})
			.handle(async () => ({ id: '888', email: 'error@example.com' }));

		const handler = new AmazonApiGatewayV1Endpoint(endpoint).handler;
		const response = await handler(
			v1Event('POST', '/users'),
			createMockContext(),
		);

		// The endpoint should still succeed despite event publishing failure
		expect(response.statusCode).toBe(200);
		expect(response.body).toBe(
			JSON.stringify({ id: '888', email: 'error@example.com' }),
		);
		expect(publisher.publish).toHaveBeenCalled();
		expect(mockLogger.error).toHaveBeenCalledWith(
			publishError,
			'Failed to publish events',
		);
	});

	it('should publish events with input data context', async () => {
		const publisher = recordTopic(users);

		const endpoint = api
			.post('/users')
			.status(201)
			.body(z.object({ name: z.string(), email: z.string() }))
			.output(z.object({ id: z.string(), name: z.string(), email: z.string() }))
			.event(users, {
				type: 'user.created',
				payload: (response) => ({ userId: response.id, email: response.email }),
			})
			.handle(async ({ body }) => ({
				id: '777',
				name: body.name,
				email: body.email,
			}));

		const handler = new AmazonApiGatewayV1Endpoint(endpoint).handler;
		const response = await handler(
			v1Event('POST', '/users', {
				body: JSON.stringify({ name: 'John Doe', email: 'john@example.com' }),
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(201);
		expect(response.body).toBe(
			JSON.stringify({
				id: '777',
				name: 'John Doe',
				email: 'john@example.com',
			}),
		);
		expect(publisher.published).toEqual([
			{
				type: 'user.created',
				payload: { userId: '777', email: 'john@example.com' },
			},
		]);
	});

	it('should not publish events when handler throws an error', async () => {
		const publisher = recordTopic(users);

		const endpoint = api
			.post('/users')
			.output(z.object({ id: z.string(), email: z.string() }))
			.event(users, {
				type: 'user.created',
				payload: (response) => ({ userId: response.id, email: response.email }),
			})
			.handle(async (): Promise<{ id: string; email: string }> => {
				throw new DatabaseConnectionFailed();
			});

		const handler = new AmazonApiGatewayV1Endpoint(endpoint).handler;
		const response = await handler(
			v1Event('POST', '/users'),
			createMockContext(),
		);

		// The endpoint should return an error response
		expect(response.statusCode).toBe(500);
		// Events should not be published when handler fails
		expect(publisher.calls).toEqual([]);
	});
});
