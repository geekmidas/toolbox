import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Endpoint, SuccessStatus } from '../Endpoint';

describe('Endpoint manifest fields', () => {
	it('should store timeout and memorySize', () => {
		const endpoint = new Endpoint({
			route: '/users/:id',
			method: 'GET',
			fn: async () => ({ id: '123' }),
			authorize: undefined,
			description: 'Get user by ID',
			timeout: 30000,
			memorySize: 512,
			input: undefined,
			output: undefined,
			services: [],
			logger: {} as any,
			getSession: undefined,
			rateLimit: undefined,
			status: SuccessStatus.OK,
		});

		expect(endpoint.timeout).toBe(30000);
		expect(endpoint.memorySize).toBe(512);
	});

	it('should store authorizer information', () => {
		const endpoint = new Endpoint({
			route: '/admin/users',
			method: 'POST',
			fn: async () => ({ success: true }),
			authorize: undefined,
			description: 'Create admin user',
			timeout: undefined,
			memorySize: undefined,
			input: undefined,
			output: undefined,
			services: [],
			logger: {} as any,
			getSession: undefined,
			rateLimit: undefined,
			status: SuccessStatus.Created,
			authorizer: {
				name: 'iam',
				type: 'AWS_IAM',
				description: 'IAM-based authorizer',
			},
		});

		expect(endpoint.authorizer).toEqual({
			name: 'iam',
			type: 'AWS_IAM',
			description: 'IAM-based authorizer',
		});
	});

	it('should have undefined authorizer when not provided', () => {
		const endpoint = new Endpoint({
			route: '/public',
			method: 'GET',
			fn: async () => ({ data: 'public' }),
			authorize: undefined,
			description: 'Public endpoint',
			timeout: undefined,
			memorySize: undefined,
			input: undefined,
			output: undefined,
			services: [],
			logger: {} as any,
			getSession: undefined,
			rateLimit: undefined,
			status: SuccessStatus.OK,
		});

		expect(endpoint.authorizer).toBeUndefined();
	});

	it('should store all manifest fields together', () => {
		const bodySchema = z.object({ name: z.string() });
		const outputSchema = z.object({ id: z.string(), name: z.string() });

		const endpoint = new Endpoint({
			route: '/api/v1/users',
			method: 'POST',
			fn: async () => ({ id: '123', name: 'Test User' }),
			authorize: undefined,
			description: 'Create a new user',
			tags: ['users', 'admin'],
			timeout: 15000,
			memorySize: 256,
			input: { body: bodySchema },
			output: outputSchema,
			services: [],
			logger: {} as any,
			getSession: undefined,
			rateLimit: undefined,
			status: SuccessStatus.Created,
			authorizer: {
				name: 'jwt-auth0',
				type: 'JWT',
				description: 'Auth0 JWT authorizer',
				metadata: {
					audience: 'https://api.example.com',
					issuer: 'https://example.auth0.com/',
				},
			},
		});

		expect(endpoint.route).toBe('/api/v1/users');
		expect(endpoint.method).toBe('POST');
		expect(endpoint.description).toBe('Create a new user');
		expect(endpoint.tags).toEqual(['users', 'admin']);
		expect(endpoint.timeout).toBe(15000);
		expect(endpoint.memorySize).toBe(256);
		expect(endpoint.status).toBe(SuccessStatus.Created);
		expect(endpoint.authorizer).toEqual({
			name: 'jwt-auth0',
			type: 'JWT',
			description: 'Auth0 JWT authorizer',
			metadata: {
				audience: 'https://api.example.com',
				issuer: 'https://example.auth0.com/',
			},
		});
	});

	it('should preserve authorizer metadata with minimal fields', () => {
		const endpoint = new Endpoint({
			route: '/protected',
			method: 'GET',
			fn: async () => ({ data: 'secret' }),
			authorize: undefined,
			description: undefined,
			timeout: undefined,
			memorySize: undefined,
			input: undefined,
			output: undefined,
			services: [],
			logger: {} as any,
			getSession: undefined,
			rateLimit: undefined,
			status: SuccessStatus.OK,
			authorizer: {
				name: 'custom',
			},
		});

		expect(endpoint.authorizer).toEqual({ name: 'custom' });
	});

	it('should handle default timeout and memorySize values', () => {
		const endpoint = new Endpoint({
			route: '/default',
			method: 'GET',
			fn: async () => ({ data: 'default' }),
			authorize: undefined,
			description: undefined,
			timeout: undefined,
			memorySize: undefined,
			input: undefined,
			output: undefined,
			services: [],
			logger: {} as any,
			getSession: undefined,
			rateLimit: undefined,
			status: SuccessStatus.OK,
		});

		// Default timeout is 30000ms (30 seconds)
		expect(endpoint.timeout).toBe(30000);
		// Default memorySize is undefined
		expect(endpoint.memorySize).toBeUndefined();
	});
});
