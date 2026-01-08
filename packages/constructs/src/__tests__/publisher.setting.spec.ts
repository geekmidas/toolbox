import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { type Service, ServiceDiscovery } from '@geekmidas/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { e } from '../endpoints';
import { publishConstructEvents } from '../publisher';

// Test event types
type TestEvent =
	| PublishableMessage<'test.created', { id: string }>
	| PublishableMessage<'test.updated', { id: string; changes: string[] }>
	| PublishableMessage<'test.deleted', { id: string }>;

describe('publisher service setting combinations', () => {
	const mockLogger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(() => mockLogger),
	};

	const serviceDiscovery = ServiceDiscovery.getInstance(
		mockLogger,
		new EnvironmentParser({}),
	);

	// Create mock publishers
	const createMockPublisher = (_name: string): EventPublisher<TestEvent> => ({
		publish: vi.fn().mockResolvedValue(undefined),
	});

	const createMockPublisherService = (
		name: string,
	): Service<string, EventPublisher<TestEvent>> => {
		const publisher = createMockPublisher(name);
		return {
			serviceName: `${name}-publisher-${Math.random()}`,
			register: vi.fn().mockResolvedValue(publisher),
		};
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('setting publisher via endpoint.publisher()', () => {
		it('should use publisher set directly on endpoint', async () => {
			const mockPublisher = createMockPublisher('endpoint');
			const mockPublisherService = createMockPublisherService('endpoint');
			mockPublisherService.register = vi.fn().mockResolvedValue(mockPublisher);

			const endpoint = e
				.logger(mockLogger)
				.post('/test')
				.publisher(mockPublisherService)
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '123' }));

			await publishConstructEvents(
				endpoint,
				{ id: '123' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			expect(mockPublisher.publish).toHaveBeenCalledWith([
				{
					type: 'test.created',
					payload: { id: '123' },
				},
			]);
		});
	});

	describe('setting publisher via factory.publisher()', () => {
		it('should use publisher from factory when not overridden', async () => {
			const mockPublisher = createMockPublisher('factory');
			const mockPublisherService = createMockPublisherService('factory');
			mockPublisherService.register = vi.fn().mockResolvedValue(mockPublisher);

			// Create factory with publisher
			const factory = e.logger(mockLogger).publisher(mockPublisherService);

			// Create endpoint using factory
			const endpoint = factory
				.post('/test')
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '123' }));

			// Verify the publisher service is set on the endpoint
			expect(endpoint.publisherService).toBeDefined();
			expect(endpoint.publisherService?.serviceName).toBe(
				mockPublisherService.serviceName,
			);

			await publishConstructEvents(
				endpoint,
				{ id: '123' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			expect(mockPublisher.publish).toHaveBeenCalledWith([
				{
					type: 'test.created',
					payload: { id: '123' },
				},
			]);
		});

		it('should work with factory that has logger and services', async () => {
			const mockPublisher = createMockPublisher('factory-with-services');
			const mockPublisherService = createMockPublisherService(
				'factory-with-services',
			);
			mockPublisherService.register = vi.fn().mockResolvedValue(mockPublisher);

			// Create factory with logger, services, and publisher
			const factory = e
				.logger(mockLogger)
				.services([])
				.publisher(mockPublisherService);

			const endpoint = factory
				.post('/test')
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '456' }));

			// Verify the publisher service is set
			expect(endpoint.publisherService).toBeDefined();
			expect(endpoint.publisherService?.serviceName).toBe(
				mockPublisherService.serviceName,
			);

			await publishConstructEvents(
				endpoint,
				{ id: '456' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			expect(mockPublisher.publish).toHaveBeenCalledWith([
				{
					type: 'test.created',
					payload: { id: '456' },
				},
			]);
		});
	});

	describe('overriding factory publisher at endpoint level', () => {
		it('should use endpoint publisher over factory publisher', async () => {
			const factoryPublisher = createMockPublisher('factory');
			const factoryPublisherService = createMockPublisherService('factory');
			factoryPublisherService.register = vi
				.fn()
				.mockResolvedValue(factoryPublisher);

			const endpointPublisher = createMockPublisher('endpoint-override');
			const endpointPublisherService =
				createMockPublisherService('endpoint-override');
			endpointPublisherService.register = vi
				.fn()
				.mockResolvedValue(endpointPublisher);

			// Create factory with publisher
			const factory = e.logger(mockLogger).publisher(factoryPublisherService);

			// Create endpoint that overrides factory publisher
			const endpoint = factory
				.post('/test')
				.publisher(endpointPublisherService) // Override factory publisher
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.updated',
					payload: (response) => ({ id: response.id, changes: ['name'] }),
				})
				.handle(async () => ({ id: '789' }));

			await publishConstructEvents(
				endpoint,
				{ id: '789' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			// Factory publisher should NOT be called
			expect(factoryPublisher.publish).not.toHaveBeenCalled();

			// Endpoint publisher SHOULD be called
			expect(endpointPublisher.publish).toHaveBeenCalledWith([
				{
					type: 'test.updated',
					payload: { id: '789', changes: ['name'] },
				},
			]);
		});
	});

	describe('publisher inheritance through endpoint builder chain', () => {
		it('should maintain publisher through builder method chain', async () => {
			const mockPublisher = createMockPublisher('chain');
			const mockPublisherService = createMockPublisherService('chain');
			mockPublisherService.register = vi.fn().mockResolvedValue(mockPublisher);

			const endpoint = e
				.logger(mockLogger)
				.post('/test')
				.publisher(mockPublisherService)
				.body(z.object({ name: z.string() }))
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async (_body) => ({ id: '999' }));

			expect(endpoint.publisherService).toBeDefined();

			await publishConstructEvents(
				endpoint,
				{ id: '999' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			expect(mockPublisher.publish).toHaveBeenCalledWith([
				{
					type: 'test.created',
					payload: { id: '999' },
				},
			]);
		});

		it('should maintain factory publisher through builder chain', async () => {
			const mockPublisher = createMockPublisher('factory-chain');
			const mockPublisherService = createMockPublisherService('factory-chain');
			mockPublisherService.register = vi.fn().mockResolvedValue(mockPublisher);

			const factory = e.logger(mockLogger).publisher(mockPublisherService);

			const endpoint = factory
				.post('/test')
				.body(z.object({ name: z.string() }))
				.query(z.object({ filter: z.string().optional() }))
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '111' }));

			expect(endpoint.publisherService).toBeDefined();

			await publishConstructEvents(
				endpoint,
				{ id: '111' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			expect(mockPublisher.publish).toHaveBeenCalledWith([
				{
					type: 'test.created',
					payload: { id: '111' },
				},
			]);
		});
	});

	describe('multiple endpoints with same/different publishers', () => {
		it('should handle multiple endpoints from same factory', async () => {
			const mockPublisher = createMockPublisher('shared-factory');
			const mockPublisherService = createMockPublisherService('shared-factory');
			mockPublisherService.register = vi.fn().mockResolvedValue(mockPublisher);

			const factory = e.logger(mockLogger).publisher(mockPublisherService);

			// Create multiple endpoints from same factory
			const endpoint1 = factory
				.post('/users')
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: 'user-1' }));

			const endpoint2 = factory
				.put('/users/:id')
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.updated',
					payload: (response) => ({ id: response.id, changes: ['status'] }),
				})
				.handle(async () => ({ id: 'user-2' }));

			// Both endpoints should have the same publisher service
			expect(endpoint1.publisherService?.serviceName).toBe(
				mockPublisherService.serviceName,
			);
			expect(endpoint2.publisherService?.serviceName).toBe(
				mockPublisherService.serviceName,
			);

			// Test both endpoints
			await publishConstructEvents(
				endpoint1,
				{ id: 'user-1' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			await publishConstructEvents(
				endpoint2,
				{ id: 'user-2' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			// Publisher should be called twice
			expect(mockPublisher.publish).toHaveBeenCalledTimes(2);
			expect(mockPublisher.publish).toHaveBeenNthCalledWith(1, [
				{
					type: 'test.created',
					payload: { id: 'user-1' },
				},
			]);
			expect(mockPublisher.publish).toHaveBeenNthCalledWith(2, [
				{
					type: 'test.updated',
					payload: { id: 'user-2', changes: ['status'] },
				},
			]);
		});

		it('should handle different publishers for different endpoints', async () => {
			const publisher1 = createMockPublisher('endpoint-1');
			const publisherService1 = createMockPublisherService('endpoint-1');
			publisherService1.register = vi.fn().mockResolvedValue(publisher1);

			const publisher2 = createMockPublisher('endpoint-2');
			const publisherService2 = createMockPublisherService('endpoint-2');
			publisherService2.register = vi.fn().mockResolvedValue(publisher2);

			const endpoint1 = e
				.logger(mockLogger)
				.post('/api/v1/resource')
				.publisher(publisherService1)
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: 'res-1' }));

			const endpoint2 = e
				.logger(mockLogger)
				.post('/api/v2/resource')
				.publisher(publisherService2)
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: 'res-2' }));

			// Test both endpoints
			await publishConstructEvents(
				endpoint1,
				{ id: 'res-1' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			await publishConstructEvents(
				endpoint2,
				{ id: 'res-2' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			// Each publisher should only be called once
			expect(publisher1.publish).toHaveBeenCalledTimes(1);
			expect(publisher1.publish).toHaveBeenCalledWith([
				{
					type: 'test.created',
					payload: { id: 'res-1' },
				},
			]);

			expect(publisher2.publish).toHaveBeenCalledTimes(1);
			expect(publisher2.publish).toHaveBeenCalledWith([
				{
					type: 'test.created',
					payload: { id: 'res-2' },
				},
			]);
		});
	});

	describe('edge cases and error scenarios', () => {
		it('should handle undefined publisher gracefully', async () => {
			const endpoint = e
				.logger(mockLogger)
				.post('/test')
				.output(z.object({ id: z.string() }))

				.event({
					// @ts-ignore
					type: 'test.created',
					// @ts-ignore
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '000' }));

			// Should not have publisher service
			expect(endpoint.publisherService).toBeUndefined();

			// Should not throw, but should warn
			await publishConstructEvents(
				endpoint,
				{ id: '000' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			expect(mockLogger.warn).toHaveBeenCalledWith(
				'No publisher service available',
			);
		});

		it('should handle publisher service registration failure', async () => {
			const registrationError = new Error('Service registration failed');
			const mockPublisherService = createMockPublisherService('failing');
			mockPublisherService.register = vi
				.fn()
				.mockRejectedValue(registrationError);

			const endpoint = e
				.logger(mockLogger)
				.post('/test')
				.publisher(mockPublisherService)
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: '404' }));

			// Should not throw but should log error
			await publishConstructEvents(
				endpoint,
				{ id: '404' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			expect(mockLogger.error).toHaveBeenCalledWith(
				registrationError,
				'Something went wrong publishing events',
			);
		});
	});

	describe('factory publisher with services', () => {
		it('should maintain publisher with services factory', async () => {
			const mockPublisher = createMockPublisher('services');
			const mockPublisherService = createMockPublisherService('services');
			mockPublisherService.register = vi.fn().mockResolvedValue(mockPublisher);

			// Test a typical factory setup with logger, services, and publisher
			const factory = e
				.logger(mockLogger)
				.services([])
				.publisher(mockPublisherService);

			const endpoint = factory
				.post('/api/v1/users')
				.output(z.object({ id: z.string() }))
				.event({
					type: 'test.created',
					payload: (response) => ({ id: response.id }),
				})
				.handle(async () => ({ id: 'services-123' }));

			expect(endpoint._path).toBe('/api/v1/users');
			expect(endpoint.publisherService).toBeDefined();

			await publishConstructEvents(
				endpoint,
				{ id: 'services-123' },
				serviceDiscovery as ServiceDiscovery<any, any>,
			);

			expect(mockPublisher.publish).toHaveBeenCalledWith([
				{
					type: 'test.created',
					payload: { id: 'services-123' },
				},
			]);
		});
	});
});
