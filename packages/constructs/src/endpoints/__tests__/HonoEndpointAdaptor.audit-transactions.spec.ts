import type {
	AuditableAction,
	AuditRecord,
	AuditStorage,
} from '@geekmidas/audit';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { MappedAudit } from '../audit';
import { Endpoint, type EndpointContext } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

/**
 * Mock transaction that simulates Kysely Transaction behavior.
 */
class MockTransaction {
	isTransaction = true as const;

	constructor(private db: MockDatabase) {}

	insert(table: string, data: unknown) {
		this.db.pendingOperations.push({ type: `insert:${table}`, data });
	}

	// Required by Kysely interface - nested transactions just return self
	transaction() {
		return this.db.transaction();
	}
}

/**
 * Mock database that simulates Kysely-like transaction behavior.
 * Tracks all operations and can simulate rollbacks.
 */
class MockDatabase {
	pendingOperations: Array<{ type: string; data: unknown }> = [];
	committedOperations: Array<{ type: string; data: unknown }> = [];
	isTransaction = false as const;
	shouldFailOnCommit = false;

	// Simulates db.transaction() returning a builder
	transaction() {
		const self = this;
		return {
			setIsolationLevel(_level: string) {
				return this;
			},
			async execute<T>(cb: (trx: MockTransaction) => Promise<T>): Promise<T> {
				const trx = new MockTransaction(self);

				try {
					const result = await cb(trx);

					if (self.shouldFailOnCommit) {
						throw new Error('Simulated commit failure');
					}

					// Commit: move pending operations to committed
					self.committedOperations.push(...self.pendingOperations);
					self.pendingOperations = [];
					return result;
				} catch (error) {
					// Rollback: discard pending operations
					self.pendingOperations = [];
					throw error;
				}
			},
		};
	}

	insert(table: string, data: unknown) {
		this.pendingOperations.push({ type: `insert:${table}`, data });
	}

	reset() {
		this.pendingOperations = [];
		this.committedOperations = [];
		this.shouldFailOnCommit = false;
	}
}

/**
 * Audit storage that uses a mock database for transactional writes.
 * Can be configured to fail on write to test rollback behavior.
 */
class TransactionalAuditStorage implements AuditStorage {
	records: AuditRecord[] = [];
	shouldFailOnWrite = false;
	writeAttempts = 0;

	constructor(private db: MockDatabase) {}

	async write(records: AuditRecord[], trx?: unknown): Promise<void> {
		this.writeAttempts++;

		if (this.shouldFailOnWrite) {
			throw new Error('Simulated audit write failure');
		}

		// If we have a transaction, use it
		if (trx) {
			const mockTrx = trx as MockTransaction;
			for (const record of records) {
				mockTrx.insert('audit_logs', record);
			}
		}

		this.records.push(...records);
	}

	async query(): Promise<AuditRecord[]> {
		return this.records;
	}

	getDatabase(): MockDatabase {
		return this.db;
	}

	reset() {
		this.records = [];
		this.shouldFailOnWrite = false;
		this.writeAttempts = 0;
	}
}

// Test audit action types
type TestAuditAction =
	| AuditableAction<'user.created', { userId: string; email: string }>
	| AuditableAction<'user.updated', { userId: string; changes: string[] }>;

describe('HonoEndpoint Audit Transactions', () => {
	let mockDb: MockDatabase;
	let auditStorage: TransactionalAuditStorage;
	let mockLogger: Logger;

	const createMockLogger = (): Logger => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(function (this: Logger) {
			return this;
		}),
	});

	const createServiceDiscovery = () => {
		const envParser = new EnvironmentParser({});
		ServiceDiscovery.reset();
		return ServiceDiscovery.getInstance(envParser);
	};

	beforeEach(() => {
		mockDb = new MockDatabase();
		auditStorage = new TransactionalAuditStorage(mockDb);
		mockLogger = createMockLogger();
	});

	describe('successful transactions', () => {
		it('should commit both handler operations and audits on success', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				TransactionalAuditStorage
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.string(), email: z.string() });

			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async () => {
					// Simulate handler database operation
					mockDb.insert('users', { id: '123', email: 'test@example.com' });
					return { id: '123', email: 'test@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);

			// Both handler operations and audits should be committed
			expect(auditStorage.records).toHaveLength(1);
			expect(auditStorage.records[0].type).toBe('user.created');
		});
	});

	describe('handler failure rollback', () => {
		it('should not write audits when handler throws an error', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				TransactionalAuditStorage
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.string(), email: z.string() });

			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async () => {
					// Simulate handler database operation before failure
					mockDb.insert('users', { id: '123', email: 'test@example.com' });
					throw new Error('Handler failed after database operation');
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			// Handler error should result in 500
			expect(response.status).toBe(500);

			// No audits should be written when handler fails
			expect(auditStorage.records).toHaveLength(0);

			// Database operations should not be committed (rolled back)
			expect(mockDb.committedOperations).toHaveLength(0);
		});

		it('should not write audits when handler validation fails', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				TransactionalAuditStorage
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({
				id: z.string().min(10), // Will fail validation
				email: z.string().email(),
			});

			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async () => {
					mockDb.insert('users', { id: '123', email: 'test@example.com' });
					// Return value that fails output validation (id too short)
					return { id: '123', email: 'test@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			// Output validation error should result in 422
			expect(response.status).toBe(422);

			// No audits should be written when output validation fails
			expect(auditStorage.records).toHaveLength(0);
		});
	});

	describe('audit failure rollback', () => {
		it('should rollback handler operations when audit write fails', async () => {
			const serviceDiscovery = createServiceDiscovery();

			// Configure audit storage to fail
			auditStorage.shouldFailOnWrite = true;

			const auditStorageService: Service<
				'auditStorage',
				TransactionalAuditStorage
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.string(), email: z.string() });

			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async () => {
					// This operation should be rolled back when audit fails
					mockDb.insert('users', { id: '123', email: 'test@example.com' });
					return { id: '123', email: 'test@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			// Audit failure should result in error response
			expect(response.status).toBe(500);

			// Audit write should have been attempted
			expect(auditStorage.writeAttempts).toBe(1);

			// No audits should be persisted
			expect(auditStorage.records).toHaveLength(0);

			// Handler database operations should not be committed (rolled back)
			expect(mockDb.committedOperations).toHaveLength(0);
		});
	});

	describe('manual audits in handler', () => {
		it('should include manual audits from handler in transaction', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const registerFn = vi.fn().mockResolvedValue(auditStorage);
			const auditStorageService: Service<
				'auditStorage',
				TransactionalAuditStorage
			> = {
				serviceName: 'auditStorage' as const,
				register: registerFn,
			};

			const outputSchema = z.object({ id: z.string(), email: z.string() });

			// No declarative audits - we'll use manual audits in the handler
			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [];

			let auditorWasAvailable = false;
			let receivedCtxKeys: string[] = [];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[],
						Logger,
						unknown,
						TestAuditAction,
						undefined,
						TransactionalAuditStorage
					>,
				) => {
					receivedCtxKeys = Object.keys(ctx);
					mockDb.insert('users', { id: '123', email: 'test@example.com' });

					// Manual audit via auditor in context - auditor is guaranteed to exist
					auditorWasAvailable = true;
					ctx.auditor.audit('user.created', {
						userId: '123',
						email: 'test@example.com',
					});

					return { id: '123', email: 'test@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			// Verify endpoint has auditorStorageService
			expect(endpoint.auditorStorageService).toBe(auditStorageService);

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);

			// Verify service was registered
			expect(registerFn).toHaveBeenCalled();

			// Verify auditor key is in context
			expect(receivedCtxKeys).toContain('auditor');

			// Verify auditor was available in handler
			expect(auditorWasAvailable).toBe(true);

			// Manual audit should be written
			expect(auditStorage.records).toHaveLength(1);
			expect(auditStorage.records[0].type).toBe('user.created');
			expect(auditStorage.records[0].payload).toEqual({
				userId: '123',
				email: 'test@example.com',
			});
		});

		it('should rollback manual audits when handler fails after audit call', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				TransactionalAuditStorage
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.string(), email: z.string() });

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[],
						Logger,
						unknown,
						TestAuditAction,
						undefined,
						TransactionalAuditStorage
					>,
				) => {
					mockDb.insert('users', { id: '123', email: 'test@example.com' });

					// Manual audit before failure - auditor is guaranteed to exist
					ctx.auditor.audit('user.created', {
						userId: '123',
						email: 'test@example.com',
					});

					// Fail after audit was recorded (but not yet flushed)
					throw new Error('Handler failed after recording audit');
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits: [],
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(500);

			// Manual audit should NOT be written because handler failed
			expect(auditStorage.records).toHaveLength(0);

			// Database operations should be rolled back
			expect(mockDb.committedOperations).toHaveLength(0);
		});
	});

	describe('combined declarative and manual audits', () => {
		it('should process both declarative and manual audits in same transaction', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				TransactionalAuditStorage
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.string(), email: z.string() });

			// Declarative audit
			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[],
						Logger,
						unknown,
						TestAuditAction,
						undefined,
						TransactionalAuditStorage
					>,
				) => {
					mockDb.insert('users', { id: '123', email: 'test@example.com' });

					// Also add a manual audit - auditor is guaranteed to exist
					ctx.auditor.audit('user.updated', {
						userId: '123',
						changes: ['email_verified'],
					});

					return { id: '123', email: 'test@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);

			// Both manual and declarative audits should be written
			expect(auditStorage.records).toHaveLength(2);

			const auditTypes = auditStorage.records.map((r) => r.type);
			expect(auditTypes).toContain('user.created'); // declarative
			expect(auditTypes).toContain('user.updated'); // manual
		});
	});
});
