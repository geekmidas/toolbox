import type {
  AuditableAction,
  AuditRecord,
  AuditStorage,
} from '@geekmidas/audit';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { MappedAudit } from '../audit';
import { e } from '../EndpointFactory';
import { TestEndpointAdaptor } from '../TestEndpointAdaptor';

// Test audit action types
type TestAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>;

// In-memory audit storage for testing - implements AuditStorage<TestAuditAction>
class InMemoryAuditStorage implements AuditStorage<TestAuditAction> {
  // Type marker for ExtractStorageAuditAction to work
  declare readonly __auditActionType?: TestAuditAction;

  records: AuditRecord[] = [];

  async write(records: AuditRecord[]): Promise<void> {
    this.records.push(...records);
  }

  async query(): Promise<AuditRecord[]> {
    return this.records;
  }

  clear(): void {
    this.records = [];
  }
}

// Mock database for testing
interface MockDatabase {
  query: (sql: string) => Promise<any[]>;
}

const createMockDatabase = (): MockDatabase => ({
  query: vi.fn().mockResolvedValue([]),
});

// Mock logger
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

describe('TestEndpointAdaptor with auditorStorage and database', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
  });

  describe('auditorStorage', () => {
    it('should process declarative audits when auditorStorage is provided', async () => {
      const auditStorage = new InMemoryAuditStorage();

      const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> =
        {
          serviceName: 'auditStorage' as const,
          register: vi.fn().mockResolvedValue(auditStorage),
        };

      const outputSchema = z.object({ id: z.string(), email: z.string() });

      type OutputType = z.infer<typeof outputSchema>;

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response: OutputType) => ({
            userId: response.id,
            email: response.email,
          }),
        },
      ];

      const endpoint = e
        .post('/users')
        .logger(mockLogger)
        .auditor(auditStorageService)
        .output(outputSchema)
        .audit(audits)
        .handle(async () => ({ id: '123', email: 'test@example.com' }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        auditorStorage: auditStorage,
      });

      expect(result).toEqual({ id: '123', email: 'test@example.com' });

      // Verify audit was written
      expect(auditStorage.records).toHaveLength(1);
      expect(auditStorage.records[0].type).toBe('user.created');
      expect(auditStorage.records[0].payload).toEqual({
        userId: '123',
        email: 'test@example.com',
      });
    });

    it('should allow manual auditing via auditor in handler context', async () => {
      const auditStorage = new InMemoryAuditStorage();

      const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> =
        {
          serviceName: 'auditStorage' as const,
          register: vi.fn().mockResolvedValue(auditStorage),
        };

      const endpoint = e
        .post('/users')
        .logger(mockLogger)
        .auditor(auditStorageService)
        .output(z.object({ id: z.string(), email: z.string() }))
        .handle(async ({ auditor }) => {
          // Manual audit in handler
          auditor.audit('user.created', {
            userId: 'manual-123',
            email: 'manual@example.com',
          });

          return { id: 'manual-123', email: 'manual@example.com' };
        });

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        auditorStorage: auditStorage,
      });

      expect(result).toEqual({ id: 'manual-123', email: 'manual@example.com' });

      // Verify manual audit was written
      expect(auditStorage.records).toHaveLength(1);
      expect(auditStorage.records[0].type).toBe('user.created');
      expect(auditStorage.records[0].payload).toEqual({
        userId: 'manual-123',
        email: 'manual@example.com',
      });
    });

    it('should extract actor from session when actorExtractor is configured', async () => {
      const auditStorage = new InMemoryAuditStorage();

      const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> =
        {
          serviceName: 'auditStorage' as const,
          register: vi.fn().mockResolvedValue(auditStorage),
        };

      const outputSchema = z.object({ id: z.string(), email: z.string() });

      type OutputType = z.infer<typeof outputSchema>;

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response: OutputType) => ({
            userId: response.id,
            email: response.email,
          }),
        },
      ];

      const endpoint = e
        .post('/users')
        .logger(mockLogger)
        .auditor(auditStorageService)
        .actor(({ header }) => ({
          id: header('x-user-id') ?? 'anonymous',
          type: 'user',
        }))
        .output(outputSchema)
        .audit(audits)
        .handle(async () => ({ id: '123', email: 'test@example.com' }));

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com', 'x-user-id': 'actor-456' },
        auditorStorage: auditStorage,
      });

      expect(result).toEqual({ id: '123', email: 'test@example.com' });

      // Verify actor was extracted
      expect(auditStorage.records).toHaveLength(1);
      expect(auditStorage.records[0].actor).toEqual({
        id: 'actor-456',
        type: 'user',
      });
    });

    it('should warn when declarative audits are configured but no auditorStorage provided', async () => {
      const outputSchema = z.object({ id: z.string(), email: z.string() });

      type OutputType = z.infer<typeof outputSchema>;

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response: OutputType) => ({
            userId: response.id,
            email: response.email,
          }),
        },
      ];

      // Create endpoint without auditor to test the warning
      const endpoint = e
        .post('/users')
        .logger(mockLogger)
        .output(outputSchema)
        .handle(async () => ({ id: '123', email: 'test@example.com' }));

      // Manually set audits to simulate a configuration error
      (endpoint as any).audits = audits;

      const adapter = new TestEndpointAdaptor(endpoint);

      // Call without auditorStorage - this won't be type-enforced without .auditor()
      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
      });

      expect(result).toEqual({ id: '123', email: 'test@example.com' });

      // Should warn about missing audit storage
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No auditor storage service available',
      );
    });
  });

  describe('database', () => {
    it('should provide database instance to handler context', async () => {
      const mockDb = createMockDatabase();
      (mockDb.query as any).mockResolvedValue([{ id: '1', name: 'Test User' }]);

      const databaseService: Service<'database', MockDatabase> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(mockDb),
      };

      const endpoint = e
        .get('/users')
        .logger(mockLogger)
        .database(databaseService)
        .output(z.object({ users: z.array(z.any()) }))
        .handle(async ({ db }) => {
          const users = await db.query('SELECT * FROM users');
          return { users };
        });

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        database: mockDb,
      });

      expect(result).toEqual({ users: [{ id: '1', name: 'Test User' }] });
      expect(mockDb.query).toHaveBeenCalledWith('SELECT * FROM users');
    });

    it('should allow using test doubles for database', async () => {
      // Create a test double that returns specific test data
      const testDb: MockDatabase = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes('users')) {
            return Promise.resolve([
              { id: 'test-1', name: 'Test User 1' },
              { id: 'test-2', name: 'Test User 2' },
            ]);
          }
          return Promise.resolve([]);
        }),
      };

      const databaseService: Service<'database', MockDatabase> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(testDb),
      };

      const endpoint = e
        .get('/users')
        .logger(mockLogger)
        .database(databaseService)
        .output(z.object({ count: z.number(), users: z.array(z.any()) }))
        .handle(async ({ db }) => {
          const users = await db.query('SELECT * FROM users');
          return { count: users.length, users };
        });

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        database: testDb,
      });

      expect(result).toEqual({
        count: 2,
        users: [
          { id: 'test-1', name: 'Test User 1' },
          { id: 'test-2', name: 'Test User 2' },
        ],
      });
    });
  });

  describe('auditorStorage and database together', () => {
    it('should support both auditorStorage and database in the same request', async () => {
      const auditStorage = new InMemoryAuditStorage();
      const mockDb = createMockDatabase();
      (mockDb.query as any).mockResolvedValue([
        { id: 'db-user-1', email: 'dbuser@example.com' },
      ]);

      const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> =
        {
          serviceName: 'auditStorage' as const,
          register: vi.fn().mockResolvedValue(auditStorage),
        };

      const databaseService: Service<'database', MockDatabase> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(mockDb),
      };

      const outputSchema = z.object({
        id: z.string(),
        email: z.string(),
        source: z.string(),
      });

      type OutputType = z.infer<typeof outputSchema>;

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response: OutputType) => ({
            userId: response.id,
            email: response.email,
          }),
        },
      ];

      const endpoint = e
        .post('/users')
        .logger(mockLogger)
        .database(databaseService)
        .auditor(auditStorageService)
        .output(outputSchema)
        .audit(audits)
        .handle(async ({ db, auditor }) => {
          // Use database
          const users = await db.query('SELECT * FROM users LIMIT 1');
          const user = users[0];

          // Manual audit
          auditor.audit('user.updated', {
            userId: user.id,
            changes: ['accessed'],
          });

          return { id: user.id, email: user.email, source: 'database' };
        });

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        database: mockDb,
        auditorStorage: auditStorage,
      });

      expect(result).toEqual({
        id: 'db-user-1',
        email: 'dbuser@example.com',
        source: 'database',
      });

      // Verify database was queried
      expect(mockDb.query).toHaveBeenCalledWith('SELECT * FROM users LIMIT 1');

      // Verify both audits were written (manual + declarative)
      expect(auditStorage.records).toHaveLength(2);
      expect(auditStorage.records[0].type).toBe('user.updated');
      expect(auditStorage.records[0].payload).toEqual({
        userId: 'db-user-1',
        changes: ['accessed'],
      });
      expect(auditStorage.records[1].type).toBe('user.created');
      expect(auditStorage.records[1].payload).toEqual({
        userId: 'db-user-1',
        email: 'dbuser@example.com',
      });
    });

    it('should work with EndpointFactory configured with default auditor and database', async () => {
      const auditStorage = new InMemoryAuditStorage();
      const mockDb = createMockDatabase();
      (mockDb.query as any).mockResolvedValue([]);

      const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> =
        {
          serviceName: 'auditStorage' as const,
          register: vi.fn().mockResolvedValue(auditStorage),
        };

      const databaseService: Service<'database', MockDatabase> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(mockDb),
      };

      // Create a router with default auditor and database
      const router = e
        .logger(mockLogger)
        .database(databaseService)
        .auditor(auditStorageService);

      const outputSchema = z.object({ success: z.boolean() });

      type OutputType = z.infer<typeof outputSchema>;

      const endpoint = router
        .get('/health')
        .output(outputSchema)
        .audit([
          {
            type: 'user.created',
            payload: (_response: OutputType) => ({
              userId: 'system',
              email: 'health@check.com',
            }),
            when: (response: OutputType) => response.success,
          },
        ] satisfies MappedAudit<TestAuditAction, typeof outputSchema>[])
        .handle(async ({ db, auditor }) => {
          // Both db and auditor should be available from router defaults
          await db.query('SELECT 1');

          // Manual audit
          auditor.audit('user.updated', {
            userId: 'system',
            changes: ['health_check'],
          });

          return { success: true };
        });

      const adapter = new TestEndpointAdaptor(endpoint);

      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        database: mockDb,
        auditorStorage: auditStorage,
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.query).toHaveBeenCalledWith('SELECT 1');

      // Both manual and declarative audits
      expect(auditStorage.records).toHaveLength(2);
    });
  });

  describe('type enforcement', () => {
    it('should require auditorStorage when endpoint uses .auditor()', async () => {
      const auditStorage = new InMemoryAuditStorage();

      const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> =
        {
          serviceName: 'auditStorage' as const,
          register: vi.fn().mockResolvedValue(auditStorage),
        };

      const endpoint = e
        .post('/users')
        .logger(mockLogger)
        .auditor(auditStorageService)
        .output(z.object({ id: z.string() }))
        .handle(async ({ auditor }) => {
          auditor.audit('user.created', {
            userId: 'test',
            email: 'test@example.com',
          });
          return { id: 'test' };
        });

      const adapter = new TestEndpointAdaptor(endpoint);

      // This call demonstrates that auditorStorage is required
      // TypeScript would error if auditorStorage was omitted
      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        auditorStorage: auditStorage, // Required when .auditor() is used
      });

      expect(result).toEqual({ id: 'test' });
    });

    it('should require database when endpoint uses .database()', async () => {
      const mockDb = createMockDatabase();

      const databaseService: Service<'database', MockDatabase> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(mockDb),
      };

      const endpoint = e
        .get('/data')
        .logger(mockLogger)
        .database(databaseService)
        .output(z.object({ data: z.array(z.any()) }))
        .handle(async ({ db }) => {
          const data = await db.query('SELECT * FROM data');
          return { data };
        });

      const adapter = new TestEndpointAdaptor(endpoint);

      // This call demonstrates that database is required
      // TypeScript would error if database was omitted
      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        database: mockDb, // Required when .database() is used
      });

      expect(result).toEqual({ data: [] });
    });

    it('should not require auditorStorage when endpoint does not use .auditor()', async () => {
      const endpoint = e
        .get('/simple')
        .logger(mockLogger)
        .output(z.object({ message: z.string() }))
        .handle(async () => ({ message: 'Hello' }));

      const adapter = new TestEndpointAdaptor(endpoint);

      // auditorStorage is NOT required here because .auditor() was not called
      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        // No auditorStorage needed
      });

      expect(result).toEqual({ message: 'Hello' });
    });

    it('should not require database when endpoint does not use .database()', async () => {
      const endpoint = e
        .get('/simple')
        .logger(mockLogger)
        .output(z.object({ message: z.string() }))
        .handle(async () => ({ message: 'Hello' }));

      const adapter = new TestEndpointAdaptor(endpoint);

      // database is NOT required here because .database() was not called
      const result = await adapter.request({
        services: {},
        headers: { host: 'example.com' },
        // No database needed
      });

      expect(result).toEqual({ message: 'Hello' });
    });
  });
});
