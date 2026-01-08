import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { EndpointFactory } from '../EndpointFactory';

const CacheService = {
	serviceName: 'cache' as const,
	async register() {
		return { get: () => 'cached' };
	},
} satisfies Service<'cache', any>;

const DatabaseService = {
	serviceName: 'database' as const,
	async register() {
		return { query: () => 'result' };
	},
} satisfies Service<'database', any>;

describe('EndpointFactory - State Isolation', () => {
	it('should create independent endpoints with sequential factory.services() calls', () => {
		const factory = new EndpointFactory();

		const endpoint1 = factory
			.services([CacheService, DatabaseService])
			.post('/user')
			.handle(() => ({}));

		const endpoint2 = factory
			.services([CacheService])
			.get('/user')
			.handle(() => ({}));

		expect(endpoint1.services.map((s) => s.serviceName)).toEqual([
			'cache',
			'database',
		]);
		expect(endpoint2.services.map((s) => s.serviceName)).toEqual(['cache']);
	});

	it('should create independent builders from reused factory instance', () => {
		const factory = new EndpointFactory().services([
			CacheService,
			DatabaseService,
		]);

		const builder1 = factory.post('/users');
		const builder2 = factory.get('/users');

		// Both should have the factory's default services
		expect((builder1 as any)._services.map((s: any) => s.serviceName)).toEqual([
			'cache',
			'database',
		]);
		expect((builder2 as any)._services.map((s: any) => s.serviceName)).toEqual([
			'cache',
			'database',
		]);

		// But they should not share the same array reference
		expect((builder1 as any)._services === (builder2 as any)._services).toBe(
			false,
		);
	});

	it('should not leak services between independent builder chains', () => {
		const factory = new EndpointFactory();

		const builder1 = factory.post('/api1').services([CacheService]);
		const builder2 = factory.post('/api2').services([DatabaseService]);

		expect((builder1 as any)._services.map((s: any) => s.serviceName)).toEqual([
			'cache',
		]);
		expect((builder2 as any)._services.map((s: any) => s.serviceName)).toEqual([
			'database',
		]);
	});

	it('should allow builder to add services without affecting other builders', () => {
		const factory = new EndpointFactory().services([CacheService]);

		const endpoint1 = factory
			.post('/test')
			.services([DatabaseService])
			.handle(() => ({}));

		const endpoint2 = factory.get('/test').handle(() => ({}));

		expect(endpoint1.services.map((s) => s.serviceName)).toEqual([
			'cache',
			'database',
		]);
		expect(endpoint2.services.map((s) => s.serviceName)).toEqual(['cache']);
	});

	it('should support base router pattern with extended services', () => {
		// Create a base router with default services
		const r = new EndpointFactory().services([CacheService, DatabaseService]);

		// Create endpoint with additional service
		const getUsers = r
			.services([CacheService])
			.get('/users')
			.handle(() => ({}));

		// Create endpoint with just base services
		const createUser = r.post('/users').handle(() => ({}));

		// getUsers should have additional service (but deduplicated)
		expect(getUsers.services.map((s) => s.serviceName)).toEqual([
			'cache',
			'database',
		]);

		// createUser should only have base services
		expect(createUser.services.map((s) => s.serviceName)).toEqual([
			'cache',
			'database',
		]);
	});

	it('should support base router pattern with truly additional services', () => {
		const AdditionalService = {
			serviceName: 'additional' as const,
			async register() {
				return { process: () => 'processed' };
			},
		} satisfies Service<'additional', any>;

		// Create a base router with default services
		const r = new EndpointFactory().services([CacheService, DatabaseService]);

		// Create endpoint with additional service
		const getUsers = r
			.services([AdditionalService])
			.get('/users')
			.handle(() => ({}));

		// Create endpoint with just base services
		const createUser = r.post('/users').handle(() => ({}));

		// getUsers should have all three services
		expect(getUsers.services.map((s) => s.serviceName)).toEqual([
			'additional',
			'cache',
			'database',
		]);

		// createUser should only have base services
		expect(createUser.services.map((s) => s.serviceName)).toEqual([
			'cache',
			'database',
		]);
	});
});
