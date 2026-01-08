/**
 * Benchmark fixtures for Hono Adaptor performance testing
 */
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { z } from 'zod';
import { e } from '../endpoints';

// ============================================================================
// Mock Services
// ============================================================================

export const mockLogger: Logger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	child: () => mockLogger,
};

export const mockDatabase = {
	selectFrom: () => ({
		selectAll: () => ({
			execute: async () => [
				{ id: '1', name: 'User 1', email: 'user1@example.com' },
				{ id: '2', name: 'User 2', email: 'user2@example.com' },
			],
		}),
	}),
	insertInto: () => ({
		values: () => ({
			returning: () => ({
				executeTakeFirstOrThrow: async () => ({
					id: 'new-id',
					name: 'New User',
					email: 'new@example.com',
				}),
			}),
		}),
	}),
};

export const databaseService = {
	serviceName: 'database' as const,
	async register() {
		return mockDatabase;
	},
} satisfies Service<'database', typeof mockDatabase>;

export const cacheService = {
	serviceName: 'cache' as const,
	async register() {
		return {
			get: async (key: string) => null,
			set: async (key: string, value: unknown) => {},
			delete: async (key: string) => {},
		};
	},
} satisfies Service<'cache', any>;

// ============================================================================
// Schemas
// ============================================================================

export const userSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string().email(),
});

export const createUserSchema = z.object({
	name: z.string().min(1),
	email: z.string().email(),
});

export const orderSchema = z.object({
	items: z.array(
		z.object({
			sku: z.string(),
			qty: z.number().int().positive(),
		}),
	),
});

export const orderResponseSchema = z.object({
	id: z.string(),
	total: z.number(),
	status: z.string(),
});

// ============================================================================
// Test Endpoints
// ============================================================================

/**
 * Scenario 1: Simple endpoint (no auth, no DB, no audits)
 * This represents the minimal overhead case
 */
export const simpleEndpoint = e
	.get('/health')
	.output(z.object({ status: z.string(), timestamp: z.number() }))
	.handle(async () => ({
		status: 'ok',
		timestamp: Date.now(),
	}));

/**
 * Scenario 2: Auth-only endpoint
 * Has authorization but no database or complex features
 */
export const authEndpoint = e
	.get('/profile')
	.authorizer('jwt')
	.output(z.object({ userId: z.string(), name: z.string() }))
	.handle(async ({ session }) => ({
		userId: (session as any)?.sub ?? 'anonymous',
		name: (session as any)?.name ?? 'Anonymous User',
	}));

/**
 * Scenario 3: Database endpoint
 * Has database service but no auth or audits
 */
export const dbEndpoint = e
	.get('/users')
	.services([databaseService])
	.output(z.array(userSchema))
	.handle(async ({ services }) => {
		const users = await services.database
			.selectFrom('users')
			.selectAll()
			.execute();
		return users as z.infer<typeof userSchema>[];
	});

/**
 * Scenario 4: Auth + Database endpoint
 * Common pattern for protected data access
 */
export const authDbEndpoint = e
	.get('/my-orders')
	.authorizer('jwt')
	.services([databaseService])
	.output(z.array(z.object({ id: z.string(), total: z.number() })))
	.handle(async ({ services, session }) => {
		// Simulated DB query
		return [
			{ id: 'order-1', total: 99.99 },
			{ id: 'order-2', total: 149.99 },
		];
	});

/**
 * Scenario 5: POST with body validation
 * Tests validation overhead
 */
export const postEndpoint = e
	.post('/users')
	.body(createUserSchema)
	.output(userSchema)
	.handle(async ({ body }) => ({
		id: 'new-id',
		name: body.name,
		email: body.email,
	}));

/**
 * Scenario 6: Full-featured endpoint
 * Auth + DB + Rate Limit + multiple services
 */
export const complexEndpoint = e
	.post('/orders')
	.authorizer('jwt')
	.services([databaseService, cacheService])
	.body(orderSchema)
	.output(orderResponseSchema)
	.handle(async ({ body, services, session }) => {
		// Simulate complex business logic
		const total = body.items.reduce((sum, item) => sum + item.qty * 10, 0);
		return {
			id: `order-${Date.now()}`,
			total,
			status: 'pending',
		};
	});

/**
 * Scenario 7: Endpoint with path params
 * Tests param validation overhead
 */
export const paramEndpoint = e
	.get('/users/:id')
	.params(z.object({ id: z.string().uuid() }))
	.output(userSchema)
	.handle(async ({ params }) => ({
		id: params.id,
		name: 'User Name',
		email: 'user@example.com',
	}));

/**
 * Scenario 8: Endpoint with query params
 * Tests query parsing overhead
 */
export const queryEndpoint = e
	.get('/search')
	.query(
		z.object({
			q: z.string().optional(),
			page: z.coerce.number().default(1),
			limit: z.coerce.number().default(10),
		}),
	)
	.output(z.object({ results: z.array(z.string()), total: z.number() }))
	.handle(async ({ query }) => ({
		results: ['result1', 'result2', 'result3'],
		total: 100,
	}));

// ============================================================================
// Endpoint Collections
// ============================================================================

export const allEndpoints = [
	simpleEndpoint,
	authEndpoint,
	dbEndpoint,
	authDbEndpoint,
	postEndpoint,
	complexEndpoint,
	paramEndpoint,
	queryEndpoint,
];

export const simpleEndpoints = [simpleEndpoint, postEndpoint];

export const authEndpoints = [authEndpoint, authDbEndpoint];

export const dbEndpoints = [dbEndpoint, authDbEndpoint, complexEndpoint];
