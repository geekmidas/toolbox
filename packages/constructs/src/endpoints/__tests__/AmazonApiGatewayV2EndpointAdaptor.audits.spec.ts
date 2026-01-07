import type {
  AuditableAction,
  AuditRecord,
  AuditStorage,
} from '@geekmidas/audit';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { type Service, ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import type { ActorExtractor, MappedAudit } from '../audit';
import { Endpoint } from '../Endpoint';

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

describe('AmazonApiGatewayV2Endpoint Audits', () => {
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

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/users',
          protocol: 'HTTP/1.1',
          sourceIp: '192.168.1.1',
          userAgent: 'test-agent',
        },
      },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({ id: '123', email: 'test@example.com' }),
    );

    // Verify audit was written
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].type).toBe('user.created');
    expect(auditStorage.records[0].payload).toEqual({
      userId: '123',
      email: 'test@example.com',
    });
  });

  it('should process multiple audits after successful endpoint execution', async () => {
    const auditStorage = new InMemoryAuditStorage();

    const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> = {
      serviceName: 'auditStorage' as const,
      register: vi.fn().mockResolvedValue(auditStorage),
    };

    const outputSchema = z.object({
      id: z.string(),
      email: z.string(),
      changes: z.array(z.string()),
    });

    const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
      },
      {
        type: 'user.updated',
        payload: (response) => ({
          userId: response.id,
          changes: response.changes,
        }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({
        id: '456',
        email: 'user@example.com',
        changes: ['name', 'email'],
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

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/users',
          protocol: 'HTTP/1.1',
          sourceIp: '192.168.1.1',
          userAgent: 'test-agent',
        },
      },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(201);

    // Verify both audits were written
    expect(auditStorage.records).toHaveLength(2);
    expect(auditStorage.records[0].type).toBe('user.created');
    expect(auditStorage.records[1].type).toBe('user.updated');
  });

  it('should respect when conditions for audits', async () => {
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
        when: (response) => response.isNew === true,
      },
      {
        type: 'user.updated',
        payload: (response) => ({ userId: response.id, changes: ['profile'] }),
        when: (response) => response.isNew === false,
      },
    ];

    const endpoint = new Endpoint({
      route: '/users/:id',
      method: 'PUT',
      fn: async () => ({
        id: '789',
        email: 'updated@example.com',
        isNew: false,
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

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'PUT',
          path: '/users/789',
          protocol: 'HTTP/1.1',
          sourceIp: '192.168.1.1',
          userAgent: 'test-agent',
        },
      },
      pathParameters: { id: '789' },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);

    // Only user.updated audit should be written due to when condition
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].type).toBe('user.updated');
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
      ip: header('x-forwarded-for'),
    });

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
      actorExtractor,
      audits,
    });

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/users',
          protocol: 'HTTP/1.1',
          sourceIp: '192.168.1.1',
          userAgent: 'test-agent',
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'user-456',
        'x-forwarded-for': '192.168.1.1',
      },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);

    // Verify actor was extracted correctly
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].actor).toEqual({
      id: 'user-456',
      type: 'user',
      ip: '192.168.1.1',
    });
  });

  it('should not process audits when no auditor storage is configured', async () => {
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
      fn: async () => ({ id: '999', email: 'test@example.com' }),
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
      auditorStorageService: undefined, // No auditor storage
      audits,
    });

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/users',
          protocol: 'HTTP/1.1',
          sourceIp: '192.168.1.1',
          userAgent: 'test-agent',
        },
      },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({ id: '999', email: 'test@example.com' }),
    );

    // Should log warning
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'No auditor storage service available',
    );
  });

  it('should not process audits when endpoint throws an error', async () => {
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
      fn: async () => {
        throw new Error('Something went wrong');
      },
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

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/users',
          protocol: 'HTTP/1.1',
          sourceIp: '192.168.1.1',
          userAgent: 'test-agent',
        },
      },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    // Should return 500 due to error
    expect(response.statusCode).toBe(500);

    // No audits should be written when endpoint throws an error
    expect(auditStorage.records).toHaveLength(0);
  });

  it('should include entityId in audit record when configured', async () => {
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

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/users',
          protocol: 'HTTP/1.1',
          sourceIp: '192.168.1.1',
          userAgent: 'test-agent',
        },
      },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(201);

    // Verify entityId and table are included
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].entityId).toBe('user-123');
    expect(auditStorage.records[0].table).toBe('users');
  });

  it('should include endpoint metadata in audit records', async () => {
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

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint as any);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/users',
          protocol: 'HTTP/1.1',
          sourceIp: '192.168.1.1',
          userAgent: 'test-agent',
        },
      },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);

    // Verify metadata includes endpoint info
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].metadata).toEqual({
      endpoint: '/users',
      method: 'POST',
    });
  });
});
