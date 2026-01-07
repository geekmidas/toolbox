import type {
  AuditableAction,
  AuditRecord,
  AuditStorage,
} from '@geekmidas/audit';
import { EnvironmentParser } from '@geekmidas/envkit';
import { ConsoleLogger } from '@geekmidas/logger/console';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import { AWSLambdaFunction } from '../AWSLambdaFunction';
import { FunctionBuilder } from '../FunctionBuilder';
import { TestFunctionAdaptor } from '../TestFunctionAdaptor';

// Define audit action types for type-safety
type UserAuditActions =
  | AuditableAction<'user.processed', { userId: string; status: string }>
  | AuditableAction<'user.failed', { userId: string; reason: string }>;

// Mock audit storage
class MockAuditStorage implements AuditStorage {
  storedRecords: AuditRecord[] = [];

  async write(records: AuditRecord[]): Promise<void> {
    this.storedRecords.push(...records);
  }

  getDatabase() {
    return undefined;
  }
}

// Audit storage service - use unique names to avoid ServiceDiscovery caching
let serviceCounter = 0;
const createAuditStorageService = <T extends string>(
  storage: MockAuditStorage,
  name?: T,
) => ({
  serviceName: (name ?? `auditStorage-${++serviceCounter}`) as T extends string
    ? T
    : `auditStorage-${number}`,
  async register() {
    return storage;
  },
});

describe('Function Audits', () => {
  let logger: ConsoleLogger;
  let envParser: EnvironmentParser<{}>;

  beforeEach(() => {
    logger = new ConsoleLogger();
    envParser = new EnvironmentParser({});
    vi.clearAllMocks();
  });

  describe('FunctionBuilder with auditor', () => {
    it('should configure auditor storage service', () => {
      const auditStorage = new MockAuditStorage();
      const auditStorageService = createAuditStorageService(auditStorage);

      const fn = new FunctionBuilder()
        .auditor(auditStorageService)
        .output(z.object({ result: z.string() }))
        .handle(async () => {
          return { result: 'success' };
        });

      expect(fn.auditorStorageService).toBe(auditStorageService);
    });

    it('should provide type-safe auditor via actions()', () => {
      const auditStorage = new MockAuditStorage();
      const auditStorageService = createAuditStorageService(auditStorage);

      const fn = new FunctionBuilder()
        .auditor(auditStorageService)
        .actions<UserAuditActions>()
        .output(z.object({ result: z.string() }))
        .handle(async ({ auditor }) => {
          // auditor should be typed with UserAuditActions
          if (auditor) {
            auditor.audit('user.processed', {
              userId: '123',
              status: 'active',
            });
          }
          return { result: 'success' };
        });

      expect(fn.auditorStorageService).toBe(auditStorageService);
    });
  });

  describe('TestFunctionAdaptor with auditor', () => {
    it('should inject auditor and flush audits', async () => {
      const auditStorage = new MockAuditStorage();
      const auditStorageService = createAuditStorageService(auditStorage);

      const fn = new FunctionBuilder()
        .auditor(auditStorageService)
        .actions<UserAuditActions>()
        .input({ userId: z.string() })
        .output(z.object({ processed: z.boolean() }))
        .handle(async ({ input, auditor }) => {
          if (auditor) {
            auditor.audit('user.processed', {
              userId: input.userId,
              status: 'completed',
            });
          }
          return { processed: true };
        });

      const adaptor = new TestFunctionAdaptor(fn);
      const result = await adaptor.invoke({
        input: { userId: 'user-123' },
        services: {},
      });

      expect(result).toEqual({ processed: true });
      expect(auditStorage.storedRecords).toHaveLength(1);
      expect(auditStorage.storedRecords[0]).toMatchObject({
        type: 'user.processed',
        payload: { userId: 'user-123', status: 'completed' },
      });
    });

    it('should work without auditor when not configured', async () => {
      const fn = new FunctionBuilder()
        .input({ value: z.number() })
        .output(z.object({ doubled: z.number() }))
        .handle(async (ctx) => {
          // auditor should be undefined when not configured
          // Use type assertion since it's not in the type when not configured
          expect((ctx as any).auditor).toBeUndefined();
          return { doubled: ctx.input.value * 2 };
        });

      const adaptor = new TestFunctionAdaptor(fn);
      const result = await adaptor.invoke({
        input: { value: 5 },
        services: {},
      });

      expect(result).toEqual({ doubled: 10 });
    });

    it('should allow injecting custom auditor', async () => {
      const customAuditStorage = new MockAuditStorage();
      const auditStorageService = createAuditStorageService(customAuditStorage);

      const fn = new FunctionBuilder()
        .auditor(auditStorageService)
        .actions<UserAuditActions>()
        .input({ trigger: z.string() })
        .output(z.object({ success: z.boolean() }))
        .handle(async ({ auditor }) => {
          if (auditor) {
            auditor.audit('user.processed', {
              userId: 'custom',
              status: 'custom-audit',
            });
          }
          return { success: true };
        });

      // Create a custom auditor with different storage
      const testStorage = new MockAuditStorage();
      const { DefaultAuditor } = await import('@geekmidas/audit');
      const customAuditor = new DefaultAuditor<UserAuditActions>({
        actor: { id: 'test', type: 'test' },
        storage: testStorage,
        metadata: { test: true },
      });

      const adaptor = new TestFunctionAdaptor(fn);
      const result = await adaptor.invoke({
        input: { trigger: 'test' },
        services: {},
        auditor: customAuditor,
      });

      expect(result).toEqual({ success: true });
      // Custom auditor's storage should have the records
      expect(testStorage.storedRecords).toHaveLength(1);
      // Default storage should be empty
      expect(customAuditStorage.storedRecords).toHaveLength(0);
    });

    it('should record multiple audits in single invocation', async () => {
      const auditStorage = new MockAuditStorage();
      const auditStorageService = createAuditStorageService(auditStorage);

      const fn = new FunctionBuilder()
        .auditor(auditStorageService)
        .actions<UserAuditActions>()
        .input({ userIds: z.array(z.string()) })
        .output(z.object({ processed: z.number() }))
        .handle(async ({ input, auditor }) => {
          for (const userId of input.userIds) {
            if (auditor) {
              auditor.audit('user.processed', {
                userId,
                status: 'batch-processed',
              });
            }
          }
          return { processed: input.userIds.length };
        });

      const adaptor = new TestFunctionAdaptor(fn);
      const result = await adaptor.invoke({
        input: { userIds: ['user-1', 'user-2', 'user-3'] },
        services: {},
      });

      expect(result).toEqual({ processed: 3 });
      expect(auditStorage.storedRecords).toHaveLength(3);
      expect(auditStorage.storedRecords.map((r) => r.payload)).toEqual([
        { userId: 'user-1', status: 'batch-processed' },
        { userId: 'user-2', status: 'batch-processed' },
        { userId: 'user-3', status: 'batch-processed' },
      ]);
    });
  });

  describe('AWSLambdaFunction with auditor', () => {
    const createMockLambdaContext = () => ({
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:region:account:function:test',
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/test',
      logStreamName: '2023/01/01/[$LATEST]test',
      getRemainingTimeInMillis: () => 30000,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
      callbackWaitsForEmptyEventLoop: true,
    });

    it('should inject auditor in Lambda handler', async () => {
      const auditStorage = new MockAuditStorage();
      const auditStorageService = createAuditStorageService(auditStorage);

      const fn = new FunctionBuilder()
        .logger(logger)
        .auditor(auditStorageService)
        .actions<UserAuditActions>()
        .input({ action: z.string() })
        .output(z.object({ completed: z.boolean() }))
        .handle(async ({ input, auditor }) => {
          if (auditor) {
            auditor.audit('user.processed', {
              userId: 'lambda-user',
              status: input.action,
            });
          }
          return { completed: true };
        });

      const adaptor = new AWSLambdaFunction(envParser, fn);
      const handler = adaptor.handler;

      const result = await handler(
        { action: 'lambda-action' },
        createMockLambdaContext(),
        vi.fn(),
      );

      expect(result).toEqual({ completed: true });
      expect(auditStorage.storedRecords).toHaveLength(1);
      expect(auditStorage.storedRecords[0]).toMatchObject({
        type: 'user.processed',
        payload: { userId: 'lambda-user', status: 'lambda-action' },
      });
    });

    it('should work without auditor when not configured', async () => {
      const fn = new FunctionBuilder()
        .logger(logger)
        .input({ value: z.number() })
        .output(z.object({ result: z.number() }))
        .handle(async (ctx) => {
          // Use type assertion since auditor is not in type when not configured
          expect((ctx as any).auditor).toBeUndefined();
          return { result: ctx.input.value + 1 };
        });

      const adaptor = new AWSLambdaFunction(envParser, fn);
      const handler = adaptor.handler;

      const result = await handler(
        { value: 10 },
        createMockLambdaContext(),
        vi.fn(),
      );

      expect(result).toEqual({ result: 11 });
    });

    it('should flush audits after successful execution', async () => {
      const auditStorage = new MockAuditStorage();
      const auditStorageService = createAuditStorageService(auditStorage);

      const fn = new FunctionBuilder()
        .logger(logger)
        .auditor(auditStorageService)
        .actions<UserAuditActions>()
        .output(z.object({ status: z.string() }))
        .handle(async ({ auditor }) => {
          if (auditor) {
            auditor.audit('user.processed', {
              userId: 'flush-test',
              status: 'pending',
            });
          }
          return { status: 'ok' };
        });

      const adaptor = new AWSLambdaFunction(envParser, fn);
      const handler = adaptor.handler;

      await handler({}, createMockLambdaContext(), vi.fn());

      // Records should be flushed
      expect(auditStorage.storedRecords).toHaveLength(1);
    });

    it('should not flush audits if none were recorded', async () => {
      const auditStorage = new MockAuditStorage();
      const writeSpy = vi.spyOn(auditStorage, 'write');
      const auditStorageService = createAuditStorageService(auditStorage);

      const fn = new FunctionBuilder()
        .logger(logger)
        .auditor(auditStorageService)
        .actions<UserAuditActions>()
        .output(z.object({ status: z.string() }))
        .handle(async () => {
          // Don't record any audits
          return { status: 'no-audits' };
        });

      const adaptor = new AWSLambdaFunction(envParser, fn);
      const handler = adaptor.handler;

      await handler({}, createMockLambdaContext(), vi.fn());

      // write should not be called
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('Auditor with entity tracking', () => {
    it('should record audits with entityId and table', async () => {
      const auditStorage = new MockAuditStorage();
      const auditStorageService = createAuditStorageService(auditStorage);

      const fn = new FunctionBuilder()
        .auditor(auditStorageService)
        .actions<UserAuditActions>()
        .input({ userId: z.string() })
        .output(z.object({ success: z.boolean() }))
        .handle(async ({ input, auditor }) => {
          if (auditor) {
            auditor.audit(
              'user.processed',
              { userId: input.userId, status: 'active' },
              { entityId: input.userId, table: 'users' },
            );
          }
          return { success: true };
        });

      const adaptor = new TestFunctionAdaptor(fn);
      await adaptor.invoke({
        input: { userId: 'entity-123' },
        services: {},
      });

      expect(auditStorage.storedRecords).toHaveLength(1);
      expect(auditStorage.storedRecords[0]).toMatchObject({
        type: 'user.processed',
        entityId: 'entity-123',
        table: 'users',
      });
    });
  });
});
