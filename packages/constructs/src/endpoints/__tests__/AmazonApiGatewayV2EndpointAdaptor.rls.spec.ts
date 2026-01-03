import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import { Endpoint } from '../Endpoint';
import type { RlsConfig } from '../EndpointBuilder';

// Mock the RLS module
vi.mock('@geekmidas/db/rls', () => ({
  withRlsContext: vi.fn(async (db, context, callback, options) => {
    // Store the call arguments for verification
    (globalThis as any).__rlsCall = { db, context, options };
    // Call the callback with the db (simulating transaction)
    return callback(db);
  }),
}));

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

describe('AmazonApiGatewayV2Endpoint RLS', () => {
  let mockLogger: Logger;
  let envParser: EnvironmentParser<{}>;

  beforeEach(() => {
    vi.clearAllMocks();
    ServiceDiscovery.reset();
    mockLogger = createMockLogger();
    envParser = new EnvironmentParser({});
    (globalThis as any).__rlsCall = undefined;
  });

  describe('RLS context handling', () => {
    it('should wrap handler with RLS context when rlsConfig is provided', async () => {
      const mockDb = {
        selectFrom: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      };

      const databaseService: Service<'database', typeof mockDb> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(mockDb),
      };

      type TestSession = { userId: string; tenantId: string };

      const rlsConfig: RlsConfig<
        [typeof databaseService],
        TestSession,
        Logger
      > = {
        extractor: async ({ session }) => ({
          user_id: session.userId,
          tenant_id: session.tenantId,
        }),
        prefix: 'app',
      };

      const outputSchema = z.object({ items: z.array(z.string()) });

      const endpoint = new Endpoint({
        route: '/items',
        method: 'GET',
        fn: async ({ db }) => {
          // The db should be passed to the handler
          expect(db).toBeDefined();
          return { items: ['item1', 'item2'] };
        },
        input: undefined,
        output: outputSchema,
        services: [databaseService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: async () => ({
          userId: 'user-123',
          tenantId: 'tenant-456',
        }),
        authorize: undefined,
        description: undefined,
        databaseService,
        rlsConfig,
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
      expect(response.body).toBe(JSON.stringify({ items: ['item1', 'item2'] }));

      // Verify withRlsContext was called with correct arguments
      const rlsCall = (globalThis as any).__rlsCall;
      expect(rlsCall).toBeDefined();
      expect(rlsCall.context).toEqual({
        user_id: 'user-123',
        tenant_id: 'tenant-456',
      });
      expect(rlsCall.options).toEqual({ prefix: 'app' });
    });

    it('should bypass RLS when rlsBypass is true', async () => {
      const mockDb = {
        selectFrom: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      };

      const databaseService: Service<'database', typeof mockDb> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(mockDb),
      };

      type TestSession = { userId: string };

      const rlsConfig: RlsConfig<
        [typeof databaseService],
        TestSession,
        Logger
      > = {
        extractor: async ({ session }) => ({
          user_id: session.userId,
        }),
        prefix: 'app',
      };

      const outputSchema = z.object({ items: z.array(z.string()) });

      const endpoint = new Endpoint({
        route: '/admin/items',
        method: 'GET',
        fn: async () => ({ items: ['admin-item'] }),
        input: undefined,
        output: outputSchema,
        services: [databaseService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: async () => ({ userId: 'admin-123' }),
        authorize: undefined,
        description: undefined,
        databaseService,
        rlsConfig,
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
      expect(response.body).toBe(JSON.stringify({ items: ['admin-item'] }));

      // withRlsContext should NOT be called when bypassed
      const rlsCall = (globalThis as any).__rlsCall;
      expect(rlsCall).toBeUndefined();
    });

    it('should not use RLS when no database service is configured', async () => {
      type TestSession = { userId: string };

      const rlsConfig: RlsConfig<[], TestSession, Logger> = {
        extractor: async ({ session }) => ({
          user_id: session.userId,
        }),
        prefix: 'app',
      };

      const outputSchema = z.object({ message: z.string() });

      const endpoint = new Endpoint({
        route: '/no-db',
        method: 'GET',
        fn: async () => ({ message: 'no database' }),
        input: undefined,
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: async () => ({ userId: 'user-123' }),
        authorize: undefined,
        description: undefined,
        databaseService: undefined, // No database service
        rlsConfig,
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
      expect(response.body).toBe(JSON.stringify({ message: 'no database' }));

      // withRlsContext should NOT be called when no db
      const rlsCall = (globalThis as any).__rlsCall;
      expect(rlsCall).toBeUndefined();
    });

    it('should handle RLS with null/undefined context values', async () => {
      const mockDb = {
        selectFrom: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      };

      const databaseService: Service<'database', typeof mockDb> = {
        serviceName: 'database' as const,
        register: vi.fn().mockResolvedValue(mockDb),
      };

      type TestSession = { userId: string; optionalField?: string };

      const rlsConfig: RlsConfig<
        [typeof databaseService],
        TestSession,
        Logger
      > = {
        extractor: async ({ session }) => ({
          user_id: session.userId,
          optional_field: session.optionalField ?? null,
        }),
        prefix: 'rls',
      };

      const outputSchema = z.object({ success: z.boolean() });

      const endpoint = new Endpoint({
        route: '/nullable',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: outputSchema,
        services: [databaseService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: async () => ({ userId: 'user-123' }), // optionalField is undefined
        authorize: undefined,
        description: undefined,
        databaseService,
        rlsConfig,
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

      const rlsCall = (globalThis as any).__rlsCall;
      expect(rlsCall).toBeDefined();
      expect(rlsCall.context).toEqual({
        user_id: 'user-123',
        optional_field: null,
      });
      expect(rlsCall.options).toEqual({ prefix: 'rls' });
    });
  });
});
