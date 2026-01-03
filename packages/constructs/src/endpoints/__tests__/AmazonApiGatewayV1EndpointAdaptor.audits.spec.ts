import type {
  AuditRecord,
  AuditStorage,
  AuditableAction,
} from '@geekmidas/audit';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { type Service, ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV1Event } from '@geekmidas/testkit/aws';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AmazonApiGatewayV1Endpoint } from '../AmazonApiGatewayV1EndpointAdaptor';
import { Endpoint } from '../Endpoint';
import type { ActorExtractor, MappedAudit } from '../audit';

// In-memory audit storage for testing
class InMemoryAuditStorage implements AuditStorage {
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

// Test audit action types
type TestAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'order.placed', { orderId: string; total: number }>;

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

describe('AmazonApiGatewayV1Endpoint Audits', () => {
  let mockLogger: Logger;
  let envParser: EnvironmentParser<{}>;

  beforeEach(() => {
    vi.clearAllMocks();
    ServiceDiscovery.reset();
    mockLogger = createMockLogger();
    envParser = new EnvironmentParser({});
  });

  it('should process audits after successful endpoint execution', async () => {
    const auditStorage = new InMemoryAuditStorage();

    const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> = {
      serviceName: 'auditStorage' as const,
      register: vi.fn().mockResolvedValue(auditStorage),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: '123', email: 'test@example.com' }),
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      memorySize: undefined,
      status: 200,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events: [],
      publisherService: undefined,
      auditorStorageService: auditStorageService,
      audits,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'POST',
      path: '/users',
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);

    // Verify audit was written
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].type).toBe('user.created');
    expect(auditStorage.records[0].payload).toEqual({
      userId: '123',
      email: 'test@example.com',
    });
  });

  it('should respect when condition and skip audit when false', async () => {
    const auditStorage = new InMemoryAuditStorage();

    const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> = {
      serviceName: 'auditStorage' as const,
      register: vi.fn().mockResolvedValue(auditStorage),
    };

    const outputSchema = z.object({
      id: z.string(),
      email: z.string(),
      isNew: z.boolean(),
    });

    const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
        when: (response) => response.isNew === true, // Only audit if isNew
      },
      {
        type: 'user.updated',
        payload: (response) => ({ userId: response.id, changes: ['profile'] }),
        when: (response) => response.isNew === false, // Only audit if not new
      },
    ];

    const endpoint = new Endpoint({
      route: '/users/:id',
      method: 'PUT',
      fn: async () => ({
        id: '789',
        email: 'updated@example.com',
        isNew: false, // Update, not create
      }),
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      memorySize: undefined,
      status: 200,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events: [],
      publisherService: undefined,
      auditorStorageService: auditStorageService,
      audits,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'PUT',
      path: '/users/789',
      pathParameters: { id: '789' },
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);

    // Only user.updated audit should be written due to when condition
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].type).toBe('user.updated');
  });

  it('should include entityId and table in audit records', async () => {
    const auditStorage = new InMemoryAuditStorage();

    const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> = {
      serviceName: 'auditStorage' as const,
      register: vi.fn().mockResolvedValue(auditStorage),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
        entityId: (response) => response.id,
        table: 'users',
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: 'user-123', email: 'test@example.com' }),
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

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'POST',
      path: '/users',
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(201);

    // Verify entityId and table are included
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].entityId).toBe('user-123');
    expect(auditStorage.records[0].table).toBe('users');
  });

  it('should extract actor from request context', async () => {
    const auditStorage = new InMemoryAuditStorage();

    const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> = {
      serviceName: 'auditStorage' as const,
      register: vi.fn().mockResolvedValue(auditStorage),
    };

    const actorExtractor: ActorExtractor = ({ header }) => ({
      id: header('x-user-id') ?? 'anonymous',
      type: 'user',
    });

    const outputSchema = z.object({ id: z.string() });

    const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
      {
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: 'test@example.com',
        }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: 'new-user' }),
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
      actorExtractor,
      audits,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'POST',
      path: '/users',
      headers: {
        'x-user-id': 'admin-user-123',
      },
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(201);

    // Verify actor was extracted
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].actor).toEqual({
      id: 'admin-user-123',
      type: 'user',
    });
  });

  it('should log warning when declarative audits are configured but no storage', async () => {
    const outputSchema = z.object({ id: z.string() });

    const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
      {
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: 'test@example.com',
        }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: 'new-user' }),
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
      auditorStorageService: undefined, // No storage service
      audits, // But has declarative audits
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'POST',
      path: '/users',
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(201);

    // Verify warning was logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'No auditor storage service available',
    );
  });

  it('should not process audits when handler fails', async () => {
    const auditStorage = new InMemoryAuditStorage();

    const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> = {
      serviceName: 'auditStorage' as const,
      register: vi.fn().mockResolvedValue(auditStorage),
    };

    const outputSchema = z.object({ id: z.string() });

    const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
      {
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: 'test@example.com',
        }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => {
        throw new Error('Handler failed');
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

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'POST',
      path: '/users',
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(500);

    // Audits should NOT be written when handler fails
    expect(auditStorage.records).toHaveLength(0);
  });

  it('should process multiple declarative audits with different when conditions', async () => {
    const auditStorage = new InMemoryAuditStorage();

    const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> = {
      serviceName: 'auditStorage' as const,
      register: vi.fn().mockResolvedValue(auditStorage),
    };

    const outputSchema = z.object({
      id: z.string(),
      email: z.string(),
      total: z.number(),
      isHighValue: z.boolean(),
    });

    const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
        when: () => true, // Always audit user creation
      },
      {
        type: 'order.placed',
        payload: (response) => ({
          orderId: response.id,
          total: response.total,
        }),
        when: (response) => response.isHighValue, // Only audit high-value orders
      },
    ];

    const endpoint = new Endpoint({
      route: '/orders',
      method: 'POST',
      fn: async () => ({
        id: 'order-999',
        email: 'buyer@example.com',
        total: 1000,
        isHighValue: true,
      }),
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

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'POST',
      path: '/orders',
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(201);

    // Both audits should be written (user.created always, order.placed for high value)
    expect(auditStorage.records).toHaveLength(2);
    expect(auditStorage.records.map((r) => r.type)).toContain('user.created');
    expect(auditStorage.records.map((r) => r.type)).toContain('order.placed');
  });
});
