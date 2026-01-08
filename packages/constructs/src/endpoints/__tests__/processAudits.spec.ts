import type {
	AuditableAction,
	AuditRecord,
	AuditStorage,
	Auditor,
} from '@geekmidas/audit';
import { DefaultAuditor } from '@geekmidas/audit';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service, ServiceDiscovery } from '@geekmidas/services';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EndpointBuilder } from '../EndpointBuilder';
import {
	createAuditContext,
	executeWithAuditTransaction,
	processEndpointAudits,
} from '../processAudits';

// Test audit actions
type TestAuditAction =
	| AuditableAction<'user.created', { userId: string; email: string }>
	| AuditableAction<'user.updated', { userId: string; changes: string[] }>;

// In-memory audit storage
class InMemoryAuditStorage implements AuditStorage {
	records: AuditRecord[] = [];
	withTransactionCalled = false;
	transactionDb: unknown = null;

	async write(records: AuditRecord[]): Promise<void> {
		this.records.push(...records);
	}

	async query(): Promise<AuditRecord[]> {
		return this.records;
	}

	withTransaction<T>(
		auditor: Auditor<any>,
		fn: () => Promise<T>,
		db?: unknown,
	): Promise<T> {
		this.withTransactionCalled = true;
		this.transactionDb = db;
		// Simulate transaction by setting a mock transaction
		if ('setTransaction' in auditor) {
			(auditor as any).setTransaction({ mockTrx: true });
		}
		return fn().then(async (result) => {
			await auditor.flush();
			return result;
		});
	}
}

// Storage without transaction support
class SimpleAuditStorage implements AuditStorage {
	records: AuditRecord[] = [];

	async write(records: AuditRecord[]): Promise<void> {
		this.records.push(...records);
	}

	async query(): Promise<AuditRecord[]> {
		return this.records;
	}
}

const createMockServiceDiscovery = (
	storage: AuditStorage,
): ServiceDiscovery<any, any> => {
	return {
		register: vi.fn().mockResolvedValue({ auditStorage: storage }),
	} as unknown as ServiceDiscovery<any, any>;
};

const auditStorageService = {
	serviceName: 'auditStorage' as const,
	async register() {
		return new InMemoryAuditStorage();
	},
} satisfies Service<'auditStorage', InMemoryAuditStorage>;

const logger = new ConsoleLogger();

describe('processAudits', () => {
	describe('processEndpointAudits', () => {
		it('should skip processing when no audits and no existing records', async () => {
			const endpoint = new EndpointBuilder('/users', 'POST').handle(
				async () => ({ id: '123' }),
			);

			const storage = new InMemoryAuditStorage();
			const discovery = createMockServiceDiscovery(storage);

			await processEndpointAudits(
				endpoint,
				{ id: '123' },
				discovery,
				logger,
				{
					session: {},
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
			);

			expect(storage.records).toHaveLength(0);
		});

		it('should warn when no storage service but has audits', async () => {
			const outputSchema = z.object({ id: z.string(), email: z.string() });

			const endpoint = new EndpointBuilder('/users', 'POST')
				.output(outputSchema)
				.audit<TestAuditAction>([
					{
						type: 'user.created',
						payload: (r) => ({ userId: r.id, email: r.email }),
					},
				])
				.handle(async () => ({ id: '123', email: 'test@test.com' }));

			const warnSpy = vi.spyOn(logger, 'warn');
			const discovery = createMockServiceDiscovery(new InMemoryAuditStorage());

			await processEndpointAudits(
				endpoint,
				{ id: '123', email: 'test@test.com' },
				discovery,
				logger,
				{
					session: {},
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
			);

			expect(warnSpy).toHaveBeenCalledWith('No auditor storage service available');
		});

		it('should process declarative audits', async () => {
			const outputSchema = z.object({ id: z.string(), email: z.string() });
			const storage = new InMemoryAuditStorage();

			// Create a custom storage service that returns our shared storage
			const customStorageService = {
				serviceName: 'auditStorage' as const,
				async register() {
					return storage;
				},
			} satisfies Service<'auditStorage', InMemoryAuditStorage>;

			const endpoint = new EndpointBuilder('/users', 'POST')
				.output(outputSchema)
				.auditor(customStorageService)
				.audit<TestAuditAction>([
					{
						type: 'user.created',
						payload: (r) => ({ userId: r.id, email: r.email }),
					},
				])
				.handle(async () => ({ id: '123', email: 'test@test.com' }));

			// Mock the service discovery to return our storage
			const mockDiscovery = {
				register: vi.fn().mockImplementation(async () => {
					return { auditStorage: storage };
				}),
			} as unknown as ServiceDiscovery<any, any>;

			await processEndpointAudits(
				endpoint,
				{ id: '123', email: 'test@test.com' },
				mockDiscovery,
				logger,
				{
					session: {},
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
			);

			expect(storage.records).toHaveLength(1);
			expect(storage.records[0].type).toBe('user.created');
			expect(storage.records[0].payload).toEqual({
				userId: '123',
				email: 'test@test.com',
			});
		});

		it('should skip audits when when condition returns false', async () => {
			const outputSchema = z.object({
				id: z.string(),
				email: z.string(),
				active: z.boolean(),
			});
			const storage = new InMemoryAuditStorage();

			const endpoint = new EndpointBuilder('/users', 'POST')
				.output(outputSchema)
				.auditor(auditStorageService)
				.audit<TestAuditAction>([
					{
						type: 'user.created',
						payload: (r) => ({ userId: r.id, email: r.email }),
						when: (r) => r.active,
					},
				])
				.handle(async () => ({
					id: '123',
					email: 'test@test.com',
					active: false,
				}));

			const discovery = createMockServiceDiscovery(storage);

			await processEndpointAudits(
				endpoint,
				{ id: '123', email: 'test@test.com', active: false },
				discovery,
				logger,
				{
					session: {},
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
			);

			expect(storage.records).toHaveLength(0);
		});

		it('should use existing auditor when provided', async () => {
			const outputSchema = z.object({ id: z.string(), email: z.string() });
			const storage = new InMemoryAuditStorage();

			const endpoint = new EndpointBuilder('/users', 'POST')
				.output(outputSchema)
				.auditor(auditStorageService)
				.audit<TestAuditAction>([
					{
						type: 'user.created',
						payload: (r) => ({ userId: r.id, email: r.email }),
					},
				])
				.handle(async () => ({ id: '123', email: 'test@test.com' }));

			const discovery = createMockServiceDiscovery(storage);

			// Create an existing auditor with some records already
			const existingAuditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'existing-user', type: 'user' },
				storage,
			});
			existingAuditor.audit('user.updated', {
				userId: '456',
				changes: ['name'],
			});

			await processEndpointAudits(
				endpoint,
				{ id: '123', email: 'test@test.com' },
				discovery,
				logger,
				{
					session: {},
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
				existingAuditor,
			);

			// Should have both the existing record and the new declarative one
			expect(storage.records).toHaveLength(2);
		});

		it('should extract actor when configured', async () => {
			const outputSchema = z.object({ id: z.string(), email: z.string() });
			const storage = new InMemoryAuditStorage();

			const endpoint = new EndpointBuilder('/users', 'POST')
				.output(outputSchema)
				.auditor(auditStorageService)
				.actor(({ session }) => ({
					id: (session as any).userId,
					type: 'user',
				}))
				.audit<TestAuditAction>([
					{
						type: 'user.created',
						payload: (r) => ({ userId: r.id, email: r.email }),
					},
				])
				.handle(async () => ({ id: '123', email: 'test@test.com' }));

			const discovery = createMockServiceDiscovery(storage);

			await processEndpointAudits(
				endpoint,
				{ id: '123', email: 'test@test.com' },
				discovery,
				logger,
				{
					session: { userId: 'actor-123' },
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
			);

			expect(storage.records).toHaveLength(1);
			expect(storage.records[0].actor.id).toBe('actor-123');
		});

		it('should handle actor extraction errors gracefully', async () => {
			const outputSchema = z.object({ id: z.string(), email: z.string() });
			const storage = new InMemoryAuditStorage();

			const endpoint = new EndpointBuilder('/users', 'POST')
				.output(outputSchema)
				.auditor(auditStorageService)
				.actor(() => {
					throw new Error('Actor extraction failed');
				})
				.audit<TestAuditAction>([
					{
						type: 'user.created',
						payload: (r) => ({ userId: r.id, email: r.email }),
					},
				])
				.handle(async () => ({ id: '123', email: 'test@test.com' }));

			const discovery = createMockServiceDiscovery(storage);

			// Should not throw, continue with system actor
			await processEndpointAudits(
				endpoint,
				{ id: '123', email: 'test@test.com' },
				discovery,
				logger,
				{
					session: {},
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
			);

			expect(storage.records).toHaveLength(1);
			expect(storage.records[0].actor.id).toBe('system');
		});

		it('should include entityId and table when configured', async () => {
			const outputSchema = z.object({ id: z.string(), email: z.string() });
			const storage = new InMemoryAuditStorage();

			const endpoint = new EndpointBuilder('/users', 'POST')
				.output(outputSchema)
				.auditor(auditStorageService)
				.audit<TestAuditAction>([
					{
						type: 'user.created',
						payload: (r) => ({ userId: r.id, email: r.email }),
						entityId: (r) => r.id,
						table: 'users',
					},
				])
				.handle(async () => ({ id: '123', email: 'test@test.com' }));

			const discovery = createMockServiceDiscovery(storage);

			await processEndpointAudits(
				endpoint,
				{ id: '123', email: 'test@test.com' },
				discovery,
				logger,
				{
					session: {},
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
			);

			expect(storage.records).toHaveLength(1);
			expect(storage.records[0].entityId).toBe('123');
			expect(storage.records[0].table).toBe('users');
		});

		it('should handle errors during processing', async () => {
			const outputSchema = z.object({ id: z.string(), email: z.string() });

			const endpoint = new EndpointBuilder('/users', 'POST')
				.output(outputSchema)
				.auditor(auditStorageService)
				.audit<TestAuditAction>([
					{
						type: 'user.created',
						payload: () => {
							throw new Error('Payload extraction failed');
						},
					},
				])
				.handle(async () => ({ id: '123', email: 'test@test.com' }));

			const discovery = createMockServiceDiscovery(new InMemoryAuditStorage());
			const errorSpy = vi.spyOn(logger, 'error');

			// Should not throw
			await processEndpointAudits(
				endpoint,
				{ id: '123', email: 'test@test.com' },
				discovery,
				logger,
				{
					session: {},
					header: () => undefined,
					cookie: () => undefined,
					services: {},
				},
			);

			expect(errorSpy).toHaveBeenCalled();
		});
	});

	describe('createAuditContext', () => {
		it('should return undefined when no storage service', async () => {
			const endpoint = new EndpointBuilder('/users', 'POST').handle(
				async () => ({ id: '123' }),
			);

			const discovery = createMockServiceDiscovery(new InMemoryAuditStorage());

			const context = await createAuditContext(endpoint, discovery, logger, {
				session: {},
				header: () => undefined,
				cookie: () => undefined,
				services: {},
			});

			expect(context).toBeUndefined();
		});

		it('should create audit context with storage and auditor', async () => {
			const storage = new InMemoryAuditStorage();

			const endpoint = new EndpointBuilder('/users', 'POST')
				.auditor(auditStorageService)
				.handle(async () => ({ id: '123' }));

			const discovery = createMockServiceDiscovery(storage);

			const context = await createAuditContext(endpoint, discovery, logger, {
				session: {},
				header: () => undefined,
				cookie: () => undefined,
				services: {},
			});

			expect(context).toBeDefined();
			expect(context!.storage).toBe(storage);
			expect(context!.auditor).toBeDefined();
		});

		it('should use custom actor extractor', async () => {
			const storage = new InMemoryAuditStorage();

			const endpoint = new EndpointBuilder('/users', 'POST')
				.auditor(auditStorageService)
				.actor(({ session }) => ({
					id: (session as any).userId,
					type: 'user',
				}))
				.handle(async () => ({ id: '123' }));

			const discovery = createMockServiceDiscovery(storage);

			const context = await createAuditContext(endpoint, discovery, logger, {
				session: { userId: 'actor-456' },
				header: () => undefined,
				cookie: () => undefined,
				services: {},
			});

			expect(context).toBeDefined();

			// Record an audit and check the actor
			context!.auditor.audit('user.created' as any, {
				userId: '123',
				email: 'test@test.com',
			});
			await context!.auditor.flush();

			expect(storage.records[0].actor.id).toBe('actor-456');
		});

		it('should use system actor when extraction fails', async () => {
			const storage = new InMemoryAuditStorage();

			const endpoint = new EndpointBuilder('/users', 'POST')
				.auditor(auditStorageService)
				.actor(() => {
					throw new Error('Actor extraction failed');
				})
				.handle(async () => ({ id: '123' }));

			const discovery = createMockServiceDiscovery(storage);

			const context = await createAuditContext(endpoint, discovery, logger, {
				session: {},
				header: () => undefined,
				cookie: () => undefined,
				services: {},
			});

			expect(context).toBeDefined();

			context!.auditor.audit('user.created' as any, {
				userId: '123',
				email: 'test@test.com',
			});
			await context!.auditor.flush();

			expect(storage.records[0].actor.id).toBe('system');
		});
	});

	describe('executeWithAuditTransaction', () => {
		it('should run handler without context', async () => {
			const handlerFn = vi.fn().mockResolvedValue({ id: '123' });

			const result = await executeWithAuditTransaction(
				undefined,
				handlerFn,
			);

			expect(result).toEqual({ id: '123' });
			expect(handlerFn).toHaveBeenCalledWith(undefined);
		});

		it('should use transaction when storage supports it', async () => {
			const storage = new InMemoryAuditStorage();
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'test', type: 'user' },
				storage,
			});

			const context = { auditor, storage };
			const handlerFn = vi.fn().mockResolvedValue({ id: '123' });

			const result = await executeWithAuditTransaction(
				context,
				handlerFn,
			);

			expect(result).toEqual({ id: '123' });
			expect(storage.withTransactionCalled).toBe(true);
		});

		it('should pass db option to storage transaction', async () => {
			const storage = new InMemoryAuditStorage();
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'test', type: 'user' },
				storage,
			});

			const context = { auditor, storage };
			const mockDb = { isMockDb: true };

			await executeWithAuditTransaction(
				context,
				async () => ({ id: '123' }),
				undefined,
				{ db: mockDb },
			);

			expect(storage.transactionDb).toBe(mockDb);
		});

		it('should call onComplete callback', async () => {
			const storage = new InMemoryAuditStorage();
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'test', type: 'user' },
				storage,
			});

			const context = { auditor, storage };
			const onComplete = vi.fn();

			const result = await executeWithAuditTransaction(
				context,
				async () => ({ id: '123' }),
				onComplete,
			);

			expect(onComplete).toHaveBeenCalledWith({ id: '123' }, auditor);
		});

		it('should flush audits when storage has no transaction support', async () => {
			const storage = new SimpleAuditStorage();
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'test', type: 'user' },
				storage,
			});

			const context = { auditor, storage };

			await executeWithAuditTransaction(
				context,
				async (a) => {
					a!.audit('user.created', { userId: '123', email: 'test@test.com' });
					return { id: '123' };
				},
			);

			expect(storage.records).toHaveLength(1);
		});

		it('should call onComplete even without transaction support', async () => {
			const storage = new SimpleAuditStorage();
			const auditor = new DefaultAuditor<TestAuditAction>({
				actor: { id: 'test', type: 'user' },
				storage,
			});

			const context = { auditor, storage };
			const onComplete = vi.fn();

			await executeWithAuditTransaction(
				context,
				async () => ({ id: '123' }),
				onComplete,
			);

			expect(onComplete).toHaveBeenCalled();
		});
	});
});
