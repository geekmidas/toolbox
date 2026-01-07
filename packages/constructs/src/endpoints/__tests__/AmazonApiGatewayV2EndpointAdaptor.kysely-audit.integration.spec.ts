import type { AuditableAction } from '@geekmidas/audit';
import {
  type AuditLogTable,
  KyselyAuditStorage,
} from '@geekmidas/audit/kysely';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
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
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import type { MappedAudit } from '../audit';
import { Endpoint, type EndpointContext } from '../Endpoint';

// Database schema - use different table names to avoid conflicts with HonoEndpoint tests
interface TestDatabase {
  awsAuditLogs: AuditLogTable;
  awsUsers: {
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

describe('AmazonApiGatewayV2Endpoint Kysely Audit Integration', () => {
  let db: Kysely<TestDatabase>;
  let auditStorage: KyselyAuditStorage<TestDatabase>;
  let mockLogger: Logger;
  let envParser: EnvironmentParser<{}>;

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
      .createTable('awsAuditLogs')
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
      .createTable('awsUsers')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('email', 'varchar', (col) => col.notNull().unique())
      .execute();

    auditStorage = new KyselyAuditStorage({
      db,
      tableName: 'awsAuditLogs',
    });
  });

  beforeEach(() => {
    mockLogger = createMockLogger();
    envParser = new EnvironmentParser({});
    ServiceDiscovery.reset();
  });

  afterEach(async () => {
    await db.deleteFrom('awsAuditLogs').execute();
    await db.deleteFrom('awsUsers').execute();
  });

  afterAll(async () => {
    await db.schema.dropTable('awsAuditLogs').ifExists().execute();
    await db.schema.dropTable('awsUsers').ifExists().execute();
    await db.destroy();
  });

  describe('declarative audits with real database', () => {
    it('should write declarative audit to database on successful request', async () => {
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

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
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

      // Verify audit was written to the real database
      const auditsInDb = await db
        .selectFrom('awsAuditLogs')
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

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
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

      expect(response.statusCode).toBe(500);

      // Verify no audit was written
      const auditsInDb = await db
        .selectFrom('awsAuditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(0);
    });
  });

  describe('manual audits with real database', () => {
    it('should write manual audits from handler to database', async () => {
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
            [],
            Logger,
            unknown,
            TestAuditAction,
            undefined,
            KyselyAuditStorage<TestDatabase>
          >,
        ) => {
          // Manual audit in handler - auditor is guaranteed to exist when TAuditStorage is configured
          ctx.auditor.audit('user.created', {
            userId: 42,
            email: 'manual@example.com',
          });

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

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
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

      // Verify manual audit was written
      const auditsInDb = await db
        .selectFrom('awsAuditLogs')
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
            [],
            Logger,
            unknown,
            TestAuditAction,
            undefined,
            KyselyAuditStorage<TestDatabase>
          >,
        ) => {
          // Manual audit before failure - auditor is guaranteed to exist
          ctx.auditor.audit('user.created', {
            userId: 99,
            email: 'shouldnotexist@example.com',
          });

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

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
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

      expect(response.statusCode).toBe(500);

      // Verify no audit was written (transaction rolled back)
      const auditsInDb = await db
        .selectFrom('awsAuditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(0);
    });
  });

  describe('transactional consistency with real database', () => {
    it('should commit both user insert and audit on success', async () => {
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
            TestAuditAction,
            undefined,
            KyselyAuditStorage<TestDatabase>
          >,
        ) => {
          const database = ctx.services.database;

          // Insert user
          const user = await database
            .insertInto('awsUsers')
            .values({ name: 'Success User', email: 'success@example.com' })
            .returningAll()
            .executeTakeFirstOrThrow();

          // Record audit - auditor is guaranteed to exist
          ctx.auditor.audit('user.created', {
            userId: user.id,
            email: user.email,
          });

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

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
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

      // Verify user was created
      const usersInDb = await db.selectFrom('awsUsers').selectAll().execute();
      expect(usersInDb).toHaveLength(1);
      expect(usersInDb[0].email).toBe('success@example.com');

      // Verify audit was written
      const auditsInDb = await db
        .selectFrom('awsAuditLogs')
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
          ctx: EndpointContext<
            undefined,
            [],
            Logger,
            unknown,
            TestAuditAction,
            undefined,
            KyselyAuditStorage<TestDatabase>
          >,
        ) => {
          // Manual audit - auditor is guaranteed to exist
          ctx.auditor.audit('user.updated', {
            userId: 100,
            changes: ['verified'],
          });

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

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
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
      const auditsInDb = await db
        .selectFrom('awsAuditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(2);

      const auditTypes = auditsInDb.map((a) => a.type).sort();
      expect(auditTypes).toEqual(['user.created', 'user.updated']);
    });
  });

  describe('actor extraction with real database', () => {
    it('should include actor information in audit records', async () => {
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

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
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
          'x-user-id': 'user-123',
        },
        body: JSON.stringify({}),
      });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(201);

      // Verify actor was included in audit
      const auditsInDb = await db
        .selectFrom('awsAuditLogs')
        .selectAll()
        .execute();

      expect(auditsInDb).toHaveLength(1);
      expect(auditsInDb[0].actorId).toBe('user-123');
      expect(auditsInDb[0].actorType).toBe('user');
    });
  });

  describe('RLS context with real database', () => {
    it('should set RLS context variables in transaction', async () => {
      const databaseService: Service<'database', Kysely<TestDatabase>> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(db),
      };

      type TestSession = { userId: string; tenantId: string };

      const outputSchema = z.object({
        userId: z.string(),
        tenantId: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/rls-test',
        method: 'GET',
        fn: async (ctx) => {
          // Query the session variables to verify they were set
          const userIdResult = await sql<{ value: string }>`
            SELECT current_setting('app.user_id', true) as value
          `.execute(ctx.db);

          const tenantIdResult = await sql<{ value: string }>`
            SELECT current_setting('app.tenant_id', true) as value
          `.execute(ctx.db);

          return {
            userId: userIdResult.rows[0]?.value ?? 'not-set',
            tenantId: tenantIdResult.rows[0]?.value ?? 'not-set',
          };
        },
        input: undefined,
        output: outputSchema,
        services: [databaseService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: async () => ({
          userId: 'test-user-123',
          tenantId: 'test-tenant-456',
        }),
        authorize: undefined,
        description: undefined,
        databaseService,
        rlsConfig: {
          extractor: async ({ session }) => ({
            user_id: session.userId,
            tenant_id: session.tenantId,
          }),
          prefix: 'app',
        },
        rlsBypass: false,
      });

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
      const handler = adapter.handler;

      const event = createMockV2Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body!);
      expect(body.userId).toBe('test-user-123');
      expect(body.tenantId).toBe('test-tenant-456');
    });

    it('should bypass RLS when rlsBypass is true', async () => {
      const databaseService: Service<'database', Kysely<TestDatabase>> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(db),
      };

      type TestSession = { userId: string };

      const outputSchema = z.object({ userId: z.string() });

      const endpoint = new Endpoint({
        route: '/admin/rls-bypass',
        method: 'GET',
        fn: async (ctx) => {
          // Query the session variable - should not be set when bypassed
          const userIdResult = await sql<{ value: string | null }>`
            SELECT current_setting('app.user_id', true) as value
          `.execute(ctx.db);

          // current_setting returns empty string when not set
          return {
            userId: userIdResult.rows[0]?.value || 'not-set',
          };
        },
        input: undefined,
        output: outputSchema,
        services: [databaseService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: async () => ({ userId: 'admin-user' }),
        authorize: undefined,
        description: undefined,
        databaseService,
        rlsConfig: {
          extractor: async ({ session }) => ({
            user_id: session.userId,
          }),
          prefix: 'app',
        },
        rlsBypass: true, // Bypass RLS
      });

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
      const handler = adapter.handler;

      const event = createMockV2Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body!);
      // When bypassed, the RLS context should not be set (returns 'not-set')
      expect(body.userId).toBe('not-set');
    });

    it('should use custom prefix for RLS context variables', async () => {
      const databaseService: Service<'database', Kysely<TestDatabase>> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(db),
      };

      type TestSession = { userId: string };

      const outputSchema = z.object({ userId: z.string() });

      const endpoint = new Endpoint({
        route: '/custom-prefix',
        method: 'GET',
        fn: async (ctx) => {
          // Query the session variable with custom prefix
          const userIdResult = await sql<{ value: string }>`
            SELECT current_setting('myapp.user_id', true) as value
          `.execute(ctx.db);

          return {
            userId: userIdResult.rows[0]?.value ?? 'not-set',
          };
        },
        input: undefined,
        output: outputSchema,
        services: [databaseService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: async () => ({ userId: 'custom-user' }),
        authorize: undefined,
        description: undefined,
        databaseService,
        rlsConfig: {
          extractor: async ({ session }) => ({
            user_id: session.userId,
          }),
          prefix: 'myapp', // Custom prefix
        },
        rlsBypass: false,
      });

      const adapter = new AmazonApiGatewayV2Endpoint(
        envParser,
        endpoint as any,
      );
      const handler = adapter.handler;

      const event = createMockV2Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body!);
      expect(body.userId).toBe('custom-user');
    });
  });
});
