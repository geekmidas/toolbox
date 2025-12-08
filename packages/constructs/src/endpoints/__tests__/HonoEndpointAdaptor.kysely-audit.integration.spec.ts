import type { AuditableAction } from '@geekmidas/audit';
import {
  KyselyAuditStorage,
  type AuditLogTable,
} from '@geekmidas/audit/kysely';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import {
  CamelCasePlugin,
  type Generated,
  Kysely,
  PostgresDialect,
  sql,
} from 'kysely';
import pg from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { Endpoint, type EndpointContext } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';
import type { MappedAudit } from '../audit';

// Database schema
interface TestDatabase {
  auditLogs: AuditLogTable;
  users: {
    id: Generated<number>;
    name: string;
    email: string;
  };
}

// Audit action types
type TestAuditAction =
  | AuditableAction<'user.created', { userId: number; email: string }>
  | AuditableAction<'user.updated', { userId: number; changes: string[] }>
  | AuditableAction<'user.deleted', { userId: number }>;

describe('HonoEndpoint Kysely Audit Integration', () => {
  let db: Kysely<TestDatabase>;
  let auditStorage: KyselyAuditStorage<TestDatabase>;
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

  const createServiceDiscovery = (logger: Logger) => {
    const envParser = new EnvironmentParser({});
    ServiceDiscovery.reset();
    return ServiceDiscovery.getInstance(logger, envParser);
  };

  beforeAll(async () => {
    db = new Kysely<TestDatabase>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          ...TEST_DATABASE_CONFIG,
          database: 'postgres',
        }),
      }),
      plugins: [new CamelCasePlugin()],
    });

    // Create audit_logs table
    await db.schema
      .createTable('auditLogs')
      .ifNotExists()
      .addColumn('id', 'varchar(32)', (col) => col.primaryKey())
      .addColumn('type', 'varchar', (col) => col.notNull())
      .addColumn('operation', 'varchar', (col) => col.notNull())
      .addColumn('table', 'varchar')
      .addColumn('entityId', 'varchar')
      .addColumn('oldValues', 'jsonb')
      .addColumn('newValues', 'jsonb')
      .addColumn('payload', 'jsonb')
      .addColumn('timestamp', 'timestamp', (col) =>
        col.defaultTo(sql`now()`).notNull(),
      )
      .addColumn('actorId', 'varchar')
      .addColumn('actorType', 'varchar')
      .addColumn('actorData', 'jsonb')
      .addColumn('metadata', 'jsonb')
      .execute();

    // Create users table
    await db.schema
      .createTable('users')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('email', 'varchar', (col) => col.notNull().unique())
      .execute();

    auditStorage = new KyselyAuditStorage({
      db,
      tableName: 'auditLogs',
    });
  });

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    await db.deleteFrom('auditLogs').execute();
    await db.deleteFrom('users').execute();
  });

  afterAll(async () => {
    await db.schema.dropTable('auditLogs').ifExists().execute();
    await db.schema.dropTable('users').ifExists().execute();
    await db.destroy();
  });

  describe('declarative audits with real database', () => {
    it('should write declarative audit to database on successful request', async () => {
      const serviceDiscovery = createServiceDiscovery(mockLogger);

      const auditStorageService: Service<
        'auditStorage',
        KyselyAuditStorage<TestDatabase>
      > = {
        serviceName: 'auditStorage' as const,
        register: vi.fn().mockResolvedValue(auditStorage),
      };

      const outputSchema = z.object({ id: z.number(), email: z.string() });

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
          return { id: 1, email: 'test@example.com' };
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

      // Verify audit was written to the real database
      const auditsInDb = await db
        .selectFrom('auditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(1);
      expect(auditsInDb[0].type).toBe('user.created');
      expect(auditsInDb[0].payload).toEqual({
        userId: 1,
        email: 'test@example.com',
      });
    });

    it('should not write audit when handler fails', async () => {
      const serviceDiscovery = createServiceDiscovery(mockLogger);

      const auditStorageService: Service<
        'auditStorage',
        KyselyAuditStorage<TestDatabase>
      > = {
        serviceName: 'auditStorage' as const,
        register: vi.fn().mockResolvedValue(auditStorage),
      };

      const outputSchema = z.object({ id: z.number(), email: z.string() });

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

      // Verify no audit was written
      const auditsInDb = await db
        .selectFrom('auditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(0);
    });
  });

  describe('manual audits with real database', () => {
    it('should write manual audits from handler to database', async () => {
      const serviceDiscovery = createServiceDiscovery(mockLogger);

      const auditStorageService: Service<
        'auditStorage',
        KyselyAuditStorage<TestDatabase>
      > = {
        serviceName: 'auditStorage' as const,
        register: vi.fn().mockResolvedValue(auditStorage),
      };

      const outputSchema = z.object({ id: z.number(), email: z.string() });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'POST',
        fn: async (
          ctx: EndpointContext<undefined, [], Logger, unknown, TestAuditAction>,
        ) => {
          // Manual audit in handler
          if (ctx.auditor) {
            ctx.auditor.audit('user.created', {
              userId: 42,
              email: 'manual@example.com',
            });
          }

          return { id: 42, email: 'manual@example.com' };
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

      expect(response.status).toBe(201);

      // Verify manual audit was written
      const auditsInDb = await db
        .selectFrom('auditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(1);
      expect(auditsInDb[0].type).toBe('user.created');
      expect(auditsInDb[0].payload).toEqual({
        userId: 42,
        email: 'manual@example.com',
      });
    });

    it('should not write manual audit when handler fails after audit call', async () => {
      const serviceDiscovery = createServiceDiscovery(mockLogger);

      const auditStorageService: Service<
        'auditStorage',
        KyselyAuditStorage<TestDatabase>
      > = {
        serviceName: 'auditStorage' as const,
        register: vi.fn().mockResolvedValue(auditStorage),
      };

      const outputSchema = z.object({ id: z.number(), email: z.string() });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'POST',
        fn: async (
          ctx: EndpointContext<undefined, [], Logger, unknown, TestAuditAction>,
        ) => {
          // Manual audit before failure
          if (ctx.auditor) {
            ctx.auditor.audit('user.created', {
              userId: 99,
              email: 'shouldnotexist@example.com',
            });
          }

          // Fail after audit
          throw new Error('Handler failed after audit');
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

      // Verify no audit was written (transaction rolled back)
      const auditsInDb = await db
        .selectFrom('auditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(0);
    });
  });

  describe('transactional consistency with real database', () => {
    it('should commit both user insert and audit on success', async () => {
      const serviceDiscovery = createServiceDiscovery(mockLogger);

      const databaseService: Service<'database', Kysely<TestDatabase>> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(db),
      };

      const auditStorageService: Service<
        'auditStorage',
        KyselyAuditStorage<TestDatabase>
      > = {
        serviceName: 'auditStorage' as const,
        register: vi.fn().mockResolvedValue(auditStorage),
      };

      const outputSchema = z.object({ id: z.number(), email: z.string() });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'POST',
        fn: async (
          ctx: EndpointContext<
            undefined,
            [typeof databaseService],
            Logger,
            unknown,
            TestAuditAction
          >,
        ) => {
          const database = ctx.services.database;

          // Insert user
          const user = await database
            .insertInto('users')
            .values({ name: 'Success User', email: 'success@example.com' })
            .returningAll()
            .executeTakeFirstOrThrow();

          // Record audit
          if (ctx.auditor) {
            ctx.auditor.audit('user.created', {
              userId: user.id,
              email: user.email,
            });
          }

          return { id: user.id, email: user.email };
        },
        input: undefined,
        output: outputSchema,
        services: [databaseService],
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

      expect(response.status).toBe(201);

      // Verify user was created
      const usersInDb = await db.selectFrom('users').selectAll().execute();
      expect(usersInDb).toHaveLength(1);
      expect(usersInDb[0].email).toBe('success@example.com');

      // Verify audit was written
      const auditsInDb = await db
        .selectFrom('auditLogs')
        .selectAll()
        .execute();
      expect(auditsInDb).toHaveLength(1);
      expect(auditsInDb[0].type).toBe('user.created');
      expect(auditsInDb[0].payload).toEqual({
        userId: usersInDb[0].id,
        email: 'success@example.com',
      });
    });

    it('should handle combined declarative and manual audits', async () => {
      const serviceDiscovery = createServiceDiscovery(mockLogger);

      const auditStorageService: Service<
        'auditStorage',
        KyselyAuditStorage<TestDatabase>
      > = {
        serviceName: 'auditStorage' as const,
        register: vi.fn().mockResolvedValue(auditStorage),
      };

      const outputSchema = z.object({ id: z.number(), email: z.string() });

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
          ctx: EndpointContext<undefined, [], Logger, unknown, TestAuditAction>,
        ) => {
          // Manual audit
          if (ctx.auditor) {
            ctx.auditor.audit('user.updated', {
              userId: 100,
              changes: ['verified'],
            });
          }

          return { id: 100, email: 'combined@example.com' };
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

      // Verify both audits were written
      const auditsInDb = await db
        .selectFrom('auditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(2);

      const auditTypes = auditsInDb.map((a) => a.type).sort();
      expect(auditTypes).toEqual(['user.created', 'user.updated']);
    });
  });

  describe('actor extraction with real database', () => {
    it('should include actor information in audit records', async () => {
      const serviceDiscovery = createServiceDiscovery(mockLogger);

      const auditStorageService: Service<
        'auditStorage',
        KyselyAuditStorage<TestDatabase>
      > = {
        serviceName: 'auditStorage' as const,
        register: vi.fn().mockResolvedValue(auditStorage),
      };

      const outputSchema = z.object({ id: z.number(), email: z.string() });

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
          return { id: 1, email: 'actor-test@example.com' };
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
        actorExtractor: async ({ header }) => {
          const userId = header('x-user-id');
          return {
            id: userId ?? 'anonymous',
            type: userId ? 'user' : 'anonymous',
          };
        },
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
          'x-user-id': 'user-123',
        },
      });

      expect(response.status).toBe(201);

      // Verify actor was included in audit
      const auditsInDb = await db
        .selectFrom('auditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(1);
      expect(auditsInDb[0].actorId).toBe('user-123');
      expect(auditsInDb[0].actorType).toBe('user');
    });
  });
});
