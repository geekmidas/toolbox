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
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';
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

describe('HonoEndpoint Audits', () => {
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

  const createServiceDiscovery = (logger: Logger) => {
    const envParser = new EnvironmentParser({});
    // Create a fresh instance by clearing the singleton
    (ServiceDiscovery as any)._instance = undefined;
    return ServiceDiscovery.getInstance(logger, envParser);
  };

  it('should process audits after successful endpoint execution', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
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

    const adaptor = new HonoEndpoint(endpoint);
    const app = new Hono();
    HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

    adaptor.addRoute(serviceDiscovery, app);

    const response = await app.request('/users', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: '123',
      email: 'test@example.com',
    });

    // Verify audit was written
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].type).toBe('user.created');
    expect(auditStorage.records[0].payload).toEqual({
      userId: '123',
      email: 'test@example.com',
    });
  });

  it('should process multiple audits after successful endpoint execution', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
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

    // Verify both audits were written
    expect(auditStorage.records).toHaveLength(2);
    expect(auditStorage.records[0].type).toBe('user.created');
    expect(auditStorage.records[1].type).toBe('user.updated');
  });

  it('should respect when conditions for audits', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
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

    const adaptor = new HonoEndpoint(endpoint);
    const app = new Hono();
    HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

    adaptor.addRoute(serviceDiscovery, app);

    const response = await app.request('/users/789', {
      method: 'PUT',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);

    // Only user.updated audit should be written due to when condition
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].type).toBe('user.updated');
  });

  it('should extract actor from request context', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
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

    const adaptor = new HonoEndpoint(endpoint);
    const app = new Hono();
    HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

    adaptor.addRoute(serviceDiscovery, app);

    const response = await app.request('/users', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'user-456',
        'x-forwarded-for': '192.168.1.1',
      },
    });

    expect(response.status).toBe(200);

    // Verify actor was extracted correctly
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].actor).toEqual({
      id: 'user-456',
      type: 'user',
      ip: '192.168.1.1',
    });
  });

  it('should not process audits when no auditor storage is configured', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
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

    const adaptor = new HonoEndpoint(endpoint);
    const app = new Hono();
    HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

    adaptor.addRoute(serviceDiscovery, app);

    const response = await app.request('/users', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: '999',
      email: 'test@example.com',
    });

    // Should log warning
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'No auditor storage service available',
    );
  });

  it('should not process audits when no audits are configured', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
    const auditStorage = new InMemoryAuditStorage();

    const auditStorageService: Service<'auditStorage', InMemoryAuditStorage> = {
      serviceName: 'auditStorage' as const,
      register: vi.fn().mockResolvedValue(auditStorage),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: '111', email: 'test@example.com' }),
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
      audits: [], // No audits
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

    expect(response.status).toBe(200);

    // No audits should be written
    expect(auditStorage.records).toHaveLength(0);
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'No declarative audits to process',
    );
  });

  it('should not process audits when endpoint throws an error', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
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

    const adaptor = new HonoEndpoint(endpoint);
    const app = new Hono();
    HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

    adaptor.addRoute(serviceDiscovery, app);

    const response = await app.request('/users', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    // Should return 500 due to error
    expect(response.status).toBe(500);

    // No audits should be written when endpoint throws an error
    expect(auditStorage.records).toHaveLength(0);
  });

  it('should include entityId in audit record when configured', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
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

    // Verify entityId and table are included
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].entityId).toBe('user-123');
    expect(auditStorage.records[0].table).toBe('users');
  });

  it('should include endpoint metadata in audit records', async () => {
    const mockLogger = createMockLogger();
    const serviceDiscovery = createServiceDiscovery(mockLogger);
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

    const adaptor = new HonoEndpoint(endpoint);
    const app = new Hono();
    HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

    adaptor.addRoute(serviceDiscovery, app);

    const response = await app.request('/users', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);

    // Verify metadata includes endpoint info
    expect(auditStorage.records).toHaveLength(1);
    expect(auditStorage.records[0].metadata).toEqual({
      endpoint: '/users',
      method: 'POST',
    });
  });
});
