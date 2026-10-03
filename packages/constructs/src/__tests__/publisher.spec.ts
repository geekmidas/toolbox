import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { publishConstructEvents, publishEvents } from '../publisher';
import { RestApi } from '../rest-api';
import { Topic } from '../topic/Topic';
import { recordingPublisher } from './__helpers__/recordingPublisher';

const users = new Topic('Users', {
	events: {
		'user.created': z.object({ userId: z.string(), email: z.string() }),
		'user.updated': z.object({
			userId: z.string(),
			changes: z.array(z.string()),
		}),
	},
});

const audit = new Topic('Audit', {
	events: {
		'audit.recorded': z.object({ subject: z.string() }),
	},
});

describe('publishConstructEvents', () => {
	const mockLogger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(() => mockLogger),
	};
	const debugSpy = mockLogger.debug as any;
	const errorSpy = mockLogger.error as any;

	/** A surface that logs to `mockLogger` — the logger is the surface's. */
	const api = new RestApi('Test', {
		path: '.',
		defaultAuthorizer: 'none',
		logger: mockLogger,
	});

	/** Nothing is configured, so anything not provided fails to register. */
	const serviceDiscovery = new ServiceDiscovery(new EnvironmentParser({}));

	const outputSchema = z.object({ id: z.string(), email: z.string() });
	const output = { id: '123', email: 'test@example.com' };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should return early when no events are defined', async () => {
		const endpoint = api
			.post('/test')
			.output(z.object({ success: z.boolean() }))
			.handle(async () => ({ success: true }));

		await publishConstructEvents<any>(
			endpoint,
			{ success: true },
			serviceDiscovery,
		);

		expect(debugSpy).toHaveBeenCalledWith('No events to publish');
	});

	it('should publish a single event through its topic publisher', async () => {
		const publisher = recordingPublisher();

		const endpoint = api
			.post('/test')
			.output(outputSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
			})
			.handle(async () => output);

		await publishConstructEvents<any>(
			endpoint,
			output,
			serviceDiscovery,
			mockLogger,
			{ users: publisher },
		);

		expect(debugSpy).toHaveBeenCalledWith(
			{ event: 'user.created' },
			'Processing event',
		);
		expect(debugSpy).toHaveBeenCalledWith(
			{ topic: 'users', eventCount: 1 },
			'Publishing events',
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

	it('should publish events to one topic in a single batch', async () => {
		const publisher = recordingPublisher();

		const endpoint = api
			.post('/test')
			.output(outputSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
			})
			.event(users, {
				type: 'user.updated',
				payload: (response) => ({ userId: response.id, changes: ['email'] }),
			})
			.handle(async () => output);

		await publishConstructEvents<any>(
			endpoint,
			output,
			serviceDiscovery,
			mockLogger,
			{ users: publisher },
		);

		expect(publisher.calls).toEqual([
			[
				{
					type: 'user.created',
					payload: { userId: '123', email: 'test@example.com' },
				},
				{
					type: 'user.updated',
					payload: { userId: '123', changes: ['email'] },
				},
			],
		]);
	});

	it('should publish to each topic through its own publisher', async () => {
		const usersPublisher = recordingPublisher();
		const auditPublisher = recordingPublisher();

		const endpoint = api
			.post('/test')
			.output(outputSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
			})
			.event(audit, {
				type: 'audit.recorded',
				payload: (response) => ({ subject: response.id }),
			})
			.handle(async () => output);

		await publishConstructEvents<any>(
			endpoint,
			output,
			serviceDiscovery,
			mockLogger,
			{ users: usersPublisher, audit: auditPublisher },
		);

		expect(usersPublisher.calls).toEqual([
			[
				{
					type: 'user.created',
					payload: { userId: '123', email: 'test@example.com' },
				},
			],
		]);
		expect(auditPublisher.calls).toEqual([
			[{ type: 'audit.recorded', payload: { subject: '123' } }],
		]);
	});

	it('should respect when condition for events', async () => {
		const publisher = recordingPublisher();
		const isNewSchema = outputSchema.extend({ isNew: z.boolean() });

		const endpoint = api
			.post('/test')
			.output(isNewSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
				when: (response) => response.isNew === true,
			})
			.event(users, {
				type: 'user.updated',
				payload: (response) => ({ userId: response.id, changes: ['email'] }),
				when: (response) => response.isNew === false,
			})
			.handle(async () => ({ ...output, isNew: false }));

		await publishConstructEvents<any>(
			endpoint,
			{ ...output, isNew: false },
			serviceDiscovery,
			mockLogger,
			{ users: publisher },
		);

		// Only the user.updated event should be published
		expect(publisher.published).toEqual([
			{
				type: 'user.updated',
				payload: { userId: '123', changes: ['email'] },
			},
		]);
	});

	it('should not publish or register anything when all when conditions are false', async () => {
		const publisher = recordingPublisher();
		const register = vi.spyOn(serviceDiscovery, 'register');

		const endpoint = api
			.post('/test')
			.output(outputSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
				when: () => false,
			})
			.event(audit, {
				type: 'audit.recorded',
				payload: (response) => ({ subject: response.id }),
				when: () => false,
			})
			.handle(async () => output);

		await publishConstructEvents<any>(
			endpoint,
			output,
			serviceDiscovery,
			mockLogger,
			{ users: publisher },
		);

		expect(publisher.calls).toEqual([]);
		expect(register).not.toHaveBeenCalled();
		register.mockRestore();
	});

	it('should handle async payload functions', async () => {
		const publisher = recordingPublisher();

		await publishEvents<any>(
			mockLogger,
			serviceDiscovery,
			[
				{
					topic: users.service,
					type: 'user.created',
					payload: async (response: typeof output) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			],
			output,
			{ users: publisher },
		);

		expect(publisher.published).toEqual([
			{
				type: 'user.created',
				payload: { userId: '123', email: 'test@example.com' },
			},
		]);
	});

	it('should catch and log publish errors', async () => {
		const publishError = new Error('Failed to connect to event bus');
		const failing = {
			publish: vi.fn().mockRejectedValue(publishError),
		};

		const endpoint = api
			.post('/test')
			.output(outputSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
			})
			.handle(async () => output);

		// Should not throw
		await publishConstructEvents<any>(
			endpoint,
			output,
			serviceDiscovery,
			mockLogger,
			{ users: failing },
		);

		expect(errorSpy).toHaveBeenCalledWith(
			publishError,
			'Failed to publish events',
		);
	});

	it('should still publish to a healthy topic when another topic fails', async () => {
		const usersPublisher = recordingPublisher();
		const failing = {
			publish: vi.fn().mockRejectedValue(new Error('audit is down')),
		};

		const endpoint = api
			.post('/test')
			.output(outputSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
			})
			.event(audit, {
				type: 'audit.recorded',
				payload: (response) => ({ subject: response.id }),
			})
			.handle(async () => output);

		await publishConstructEvents<any>(
			endpoint,
			output,
			serviceDiscovery,
			mockLogger,
			{ users: usersPublisher, audit: failing },
		);

		expect(usersPublisher.published).toHaveLength(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.any(Error),
			'Failed to publish events',
		);
	});

	it('should register a topic publisher that was not provided, and log when it cannot', async () => {
		// No USERS_PUBLISHER_CONNECTION_STRING: the topic's own service is
		// registered, its env cannot parse, and the failure is logged rather
		// than thrown — the handler has already succeeded.
		const endpoint = api
			.post('/test')
			.output(outputSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
			})
			.handle(async () => output);

		await expect(
			publishConstructEvents<any>(
				endpoint,
				output,
				serviceDiscovery,
				mockLogger,
			),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledWith(
			expect.anything(),
			'Something went wrong publishing events',
		);
	});

	it('should register only the topics that were not provided', async () => {
		const usersPublisher = recordingPublisher();
		const auditPublisher = recordingPublisher();
		const discovery = new ServiceDiscovery(new EnvironmentParser({}));
		const register = vi
			.spyOn(discovery, 'register')
			.mockResolvedValue({ audit: auditPublisher } as never);

		const endpoint = api
			.post('/test')
			.output(outputSchema)
			.event(users, {
				type: 'user.created',
				payload: (response) => ({
					userId: response.id,
					email: response.email,
				}),
			})
			.event(audit, {
				type: 'audit.recorded',
				payload: (response) => ({ subject: response.id }),
			})
			.handle(async () => output);

		await publishConstructEvents<any>(endpoint, output, discovery, mockLogger, {
			users: usersPublisher,
		});

		expect(register).toHaveBeenCalledWith([audit.service]);
		expect(usersPublisher.published).toHaveLength(1);
		expect(auditPublisher.published).toEqual([
			{ type: 'audit.recorded', payload: { subject: '123' } },
		]);
	});
});
