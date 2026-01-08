import type {
	AuditableAction,
	AuditRecord,
	AuditStorage,
} from '@geekmidas/audit';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import { LogLevel } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { bench, describe } from 'vitest';
import { z } from 'zod';
import { e } from '../endpoints';
import type { MappedAudit } from '../endpoints/audit';
import { TestEndpointAdaptor } from '../endpoints/TestEndpointAdaptor';

// Silent logger for benchmarks - no console output
const silentLogger = new ConsoleLogger({}, LogLevel.Silent);
const api = e.logger(silentLogger);

// ============================================================================
// Mock Services for Benchmarks
// ============================================================================

// Simple database service
interface MockDatabase {
	query: (sql: string) => Promise<any[]>;
	findById: (table: string, id: string) => Promise<any>;
}

const DatabaseService: Service<'database', MockDatabase> = {
	serviceName: 'database' as const,
	register: async () => ({
		query: async () => [],
		findById: async (table, id) => ({ id, table }),
	}),
};

// Cache service
interface MockCache {
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string) => Promise<void>;
}

const CacheService: Service<'cache', MockCache> = {
	serviceName: 'cache' as const,
	register: async () => ({
		get: async () => null,
		set: async () => {},
	}),
};

// Auth service
interface MockAuth {
	validateToken: (token: string) => Promise<boolean>;
	getUserId: (token: string) => Promise<string>;
}

const AuthService: Service<'auth', MockAuth> = {
	serviceName: 'auth' as const,
	register: async () => ({
		validateToken: async () => true,
		getUserId: async () => 'user-123',
	}),
};

// Audit storage
type TestAuditAction =
	| AuditableAction<'user.created', { userId: string }>
	| AuditableAction<'user.updated', { userId: string }>;

class MockAuditStorage implements AuditStorage<TestAuditAction> {
	declare readonly __auditActionType?: TestAuditAction;
	async write(_records: AuditRecord[]): Promise<void> {}
	async query(): Promise<AuditRecord[]> {
		return [];
	}
}

const AuditStorageService: Service<'auditStorage', MockAuditStorage> = {
	serviceName: 'auditStorage' as const,
	register: async () => new MockAuditStorage(),
};

// Event publisher
type TestEvent = PublishableMessage<'user.created', { userId: string }>;

class MockPublisher implements EventPublisher<TestEvent> {
	async publish(_messages: TestEvent[]): Promise<void> {}
	async close(): Promise<void> {}
}

const PublisherService: Service<'publisher', MockPublisher> = {
	serviceName: 'publisher' as const,
	register: async () => new MockPublisher(),
};

// Pre-registered services for benchmarks
const registeredDatabase = await DatabaseService.register({} as any);
const registeredCache = await CacheService.register({} as any);
const registeredAuth = await AuthService.register({} as any);
const auditStorage = new MockAuditStorage();

describe('Endpoint Handling - Simple', () => {
	const simpleEndpoint = api
		.get('/health')
		.handle(async () => ({ status: 'ok' }));
	const adaptor = new TestEndpointAdaptor(simpleEndpoint);

	bench('simple GET endpoint', async () => {
		await adaptor.request({
			services: {},
			headers: {},
		});
	});
});

describe('Endpoint Handling - With Validation', () => {
	const validatedEndpoint = api
		.post('/users')
		.body(z.object({ name: z.string(), email: z.string().email() }))
		.output(z.object({ id: z.string() }))
		.handle(async () => ({ id: '123' }));

	const adaptor = new TestEndpointAdaptor(validatedEndpoint);

	bench('POST with body validation', async () => {
		await adaptor.request({
			services: {},
			headers: { 'content-type': 'application/json' },
			body: { name: 'Test User', email: 'test@example.com' },
		});
	});

	const complexBodyEndpoint = api
		.post('/complex')
		.body(
			z.object({
				user: z.object({
					name: z.string(),
					email: z.string().email(),
					profile: z.object({
						bio: z.string().optional(),
						avatar: z.string().url().optional(),
					}),
				}),
				items: z.array(
					z.object({
						id: z.string(),
						quantity: z.number().int().positive(),
					}),
				),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handle(async () => ({ success: true }));

	const complexAdaptor = new TestEndpointAdaptor(complexBodyEndpoint);

	bench('POST with complex body validation', async () => {
		await complexAdaptor.request({
			services: {},
			headers: { 'content-type': 'application/json' },
			body: {
				user: {
					name: 'Test',
					email: 'test@example.com',
					profile: { bio: 'Hello', avatar: 'https://example.com/avatar.jpg' },
				},
				items: [
					{ id: '1', quantity: 2 },
					{ id: '2', quantity: 5 },
				],
			},
		});
	});
});

describe('Endpoint Handling - Path Params', () => {
	const paramsEndpoint = api
		.get('/users/:id')
		.params(z.object({ id: z.string() }))
		.output(z.object({ id: z.string(), name: z.string() }))
		.handle(async ({ params }) => ({ id: params.id, name: 'User' }));

	const adaptor = new TestEndpointAdaptor(paramsEndpoint);

	bench('GET with path params', async () => {
		await adaptor.request({
			services: {},
			headers: {},
			params: { id: '123' },
		});
	});
});

describe('Endpoint Handling - Query Params', () => {
	const queryEndpoint = api
		.get('/search')
		.query(
			z.object({
				q: z.string(),
				page: z.coerce.number().default(1),
				limit: z.coerce.number().default(10),
			}),
		)
		.output(z.object({ results: z.array(z.unknown()) }))
		.handle(async () => ({ results: [] }));

	const adaptor = new TestEndpointAdaptor(queryEndpoint);

	bench('GET with query params', async () => {
		await adaptor.request({
			services: {},
			headers: {},
			query: { q: 'test', page: 2, limit: 20 },
		});
	});
});

// ============================================================================
// Service Integration Benchmarks
// ============================================================================

describe('Endpoint Handling - Single Service', () => {
	const singleServiceEndpoint = api
		.get('/users/:id')
		.services([DatabaseService])
		.params(z.object({ id: z.string() }))
		.output(z.object({ id: z.string(), name: z.string() }))
		.handle(async ({ params, services }) => {
			const user = await services.database.findById('users', params.id);
			return { id: user.id, name: 'User' };
		});

	const adaptor = new TestEndpointAdaptor(singleServiceEndpoint);

	bench('GET with single service', async () => {
		await adaptor.request({
			services: { database: registeredDatabase },
			headers: {},
			params: { id: '123' },
		});
	});
});

describe('Endpoint Handling - Multiple Services', () => {
	const multiServiceEndpoint = api
		.get('/users/:id')
		.services([DatabaseService, CacheService, AuthService])
		.params(z.object({ id: z.string() }))
		.output(z.object({ id: z.string(), name: z.string(), cached: z.boolean() }))
		.handle(async ({ params, services }) => {
			// Check cache first
			const cached = await services.cache.get(`user:${params.id}`);
			if (cached) {
				return { id: params.id, name: cached, cached: true };
			}
			// Validate auth
			await services.auth.validateToken('token');
			// Query database
			const user = await services.database.findById('users', params.id);
			await services.cache.set(`user:${params.id}`, 'User');
			return { id: user.id, name: 'User', cached: false };
		});

	const adaptor = new TestEndpointAdaptor(multiServiceEndpoint);

	bench('GET with multiple services (3)', async () => {
		await adaptor.request({
			services: {
				database: registeredDatabase,
				cache: registeredCache,
				auth: registeredAuth,
			},
			headers: {},
			params: { id: '123' },
		});
	});
});

// ============================================================================
// Session & Authorization Benchmarks
// ============================================================================

describe('Endpoint Handling - Session Extraction', () => {
	type UserSession = { userId: string; role: string };

	// Session is configured at factory level
	const sessionApi = api.session<UserSession>(async ({ header }) => {
		const token = header('authorization')?.replace('Bearer ', '');
		if (!token) return { userId: 'anonymous', role: 'guest' };
		return { userId: 'user-123', role: 'admin' };
	});

	const sessionEndpoint = sessionApi
		.get('/profile')
		.output(z.object({ userId: z.string(), role: z.string() }))
		.handle(async ({ session }) => ({
			userId: session.userId,
			role: session.role,
		}));

	const adaptor = new TestEndpointAdaptor(sessionEndpoint);

	bench('GET with session extraction', async () => {
		await adaptor.request({
			services: {},
			headers: { authorization: 'Bearer test-token' },
		});
	});
});

describe('Endpoint Handling - Authorization', () => {
	// Authorization is configured at factory level
	const authApi = api.authorize(async ({ header }) => {
		const token = header('authorization');
		return token === 'Bearer admin-token';
	});

	const authEndpoint = authApi
		.post('/admin/action')
		.body(z.object({ action: z.string() }))
		.output(z.object({ success: z.boolean() }))
		.handle(async () => ({ success: true }));

	const adaptor = new TestEndpointAdaptor(authEndpoint);

	bench('POST with authorization check', async () => {
		await adaptor.request({
			services: {},
			headers: {
				authorization: 'Bearer admin-token',
				'content-type': 'application/json',
			},
			body: { action: 'delete-all' },
		});
	});
});

// ============================================================================
// Audit Logging Benchmarks
// ============================================================================

describe('Endpoint Handling - Declarative Audit', () => {
	const outputSchema = z.object({ id: z.string(), email: z.string() });
	type OutputType = z.infer<typeof outputSchema>;

	const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
		{
			type: 'user.created',
			payload: (response: OutputType) => ({ userId: response.id }),
		},
	];

	const auditEndpoint = api
		.post('/users')
		.auditor(AuditStorageService)
		.body(z.object({ name: z.string(), email: z.string() }))
		.output(outputSchema)
		.audit(audits)
		.handle(async ({ body }) => ({
			id: crypto.randomUUID(),
			email: body.email,
		}));

	const adaptor = new TestEndpointAdaptor(auditEndpoint);

	bench('POST with declarative audit', async () => {
		await adaptor.request({
			services: {},
			headers: { 'content-type': 'application/json' },
			body: { name: 'Test User', email: 'test@example.com' },
			auditorStorage: auditStorage,
		});
	});
});

describe('Endpoint Handling - Manual Audit', () => {
	const manualAuditEndpoint = api
		.post('/users')
		.auditor(AuditStorageService)
		.body(z.object({ name: z.string(), email: z.string() }))
		.output(z.object({ id: z.string() }))
		.handle(async ({ body, auditor }) => {
			const id = crypto.randomUUID();
			auditor?.audit('user.created', { userId: id });
			return { id };
		});

	const adaptor = new TestEndpointAdaptor(manualAuditEndpoint);

	bench('POST with manual audit', async () => {
		await adaptor.request({
			services: {},
			headers: { 'content-type': 'application/json' },
			body: { name: 'Test User', email: 'test@example.com' },
			auditorStorage: auditStorage,
		});
	});
});

// ============================================================================
// Event Publishing Benchmarks
// ============================================================================

describe('Endpoint Handling - Event Publishing', () => {
	const publisherEndpoint = api
		.post('/users')
		.publisher(PublisherService)
		.body(z.object({ name: z.string(), email: z.string() }))
		.output(z.object({ id: z.string() }))
		.event({
			type: 'user.created',
			payload: (response) => ({ userId: response.id }),
		})
		.handle(async () => ({ id: crypto.randomUUID() }));

	const adaptor = new TestEndpointAdaptor(publisherEndpoint);

	bench('POST with event publishing', async () => {
		await adaptor.request({
			services: {},
			headers: { 'content-type': 'application/json' },
			body: { name: 'Test User', email: 'test@example.com' },
			publisher: PublisherService,
		});
	});
});

// ============================================================================
// Complex Real-World Scenarios
// ============================================================================

describe('Endpoint Handling - Full Stack (Services + Session + Audit)', () => {
	type UserSession = { userId: string; role: string };
	const outputSchema = z.object({ id: z.string(), email: z.string() });
	type OutputType = z.infer<typeof outputSchema>;

	const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
		{
			type: 'user.created',
			payload: (response: OutputType) => ({ userId: response.id }),
		},
	];

	// Configure factory with session and authorization
	const fullStackApi = api
		.services([DatabaseService, CacheService])
		.session<UserSession>(async () => ({ userId: 'admin-123', role: 'admin' }))
		.authorize(async ({ session }) => session.role === 'admin');

	const fullStackEndpoint = fullStackApi
		.post('/users')
		.auditor(AuditStorageService)
		.body(
			z.object({
				name: z.string(),
				email: z.string().email(),
				profile: z.object({ bio: z.string().optional() }),
			}),
		)
		.output(outputSchema)
		.audit(audits)
		.handle(async ({ body, services }) => {
			// Simulate real work
			await services.database.query('INSERT INTO users...');
			await services.cache.set(`user:new`, body.name);
			return {
				id: crypto.randomUUID(),
				email: body.email,
			};
		});

	const adaptor = new TestEndpointAdaptor(fullStackEndpoint);

	bench('POST full stack (services + session + audit)', async () => {
		await adaptor.request({
			services: {
				database: registeredDatabase,
				cache: registeredCache,
			},
			headers: {
				authorization: 'Bearer admin-token',
				'content-type': 'application/json',
			},
			body: {
				name: 'New User',
				email: 'new@example.com',
				profile: { bio: 'Hello world' },
			},
			auditorStorage: auditStorage,
		});
	});
});
