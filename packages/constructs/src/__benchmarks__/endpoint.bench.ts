import type {
  AuditRecord,
  AuditStorage,
  AuditableAction,
} from '@geekmidas/audit';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import { LogLevel } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { bench, describe } from 'vitest';
import { z } from 'zod';
import { e } from '../endpoints';
import { TestEndpointAdaptor } from '../endpoints/TestEndpointAdaptor';
import type { MappedAudit } from '../endpoints/audit';

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
