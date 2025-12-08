import type { AuditRecord, AuditStorage } from '@geekmidas/audit';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { FunctionBuilder } from '../FunctionBuilder';

// In-memory audit storage for testing
class InMemoryAuditStorage implements AuditStorage {
  records: AuditRecord[] = [];

  async write(records: AuditRecord[]): Promise<void> {
    this.records.push(...records);
  }

  async query(): Promise<AuditRecord[]> {
    return this.records;
  }
}

const ServiceA = {
  serviceName: 'a' as const,
  async register() {
    return { test: () => 'a' };
  },
} satisfies Service<'a', any>;

const ServiceB = {
  serviceName: 'b' as const,
  async register() {
    return { test: () => 'b' };
  },
} satisfies Service<'b', any>;

describe('FunctionBuilder - State Isolation', () => {
  describe('singleton instance state reset', () => {
    it('should reset services after handle() is called', () => {
      const f = new FunctionBuilder();

      // First function with ServiceA and ServiceB
      const fn1 = f.services([ServiceA, ServiceB]).handle(async () => ({}));

      // Second function should not have any services from first
      const fn2 = f.handle(async () => ({}));

      expect(fn1.services.map((s) => s.serviceName)).toEqual(['a', 'b']);
      expect(fn2.services).toEqual([]);
    });

    it('should reset logger after handle() is called', () => {
      const f = new FunctionBuilder();
      const customLogger = new ConsoleLogger({ app: 'custom' });

      // First function with custom logger
      const fn1 = f.logger(customLogger).handle(async () => ({}));

      // Second function should have default logger (not the custom one)
      const fn2 = f.handle(async () => ({}));

      expect(fn1.logger).toBe(customLogger);
      expect(fn2.logger).not.toBe(customLogger);
      expect(fn2.logger).toBeInstanceOf(ConsoleLogger);
    });

    it('should reset events after handle() is called', () => {
      const f = new FunctionBuilder();

      // Create first function (events array should be empty initially)
      const fn1 = f.handle(async () => ({}));

      // Verify function was created and state was reset
      expect(fn1).toBeDefined();
      expect((f as any)._events).toEqual([]);
      expect((f as any)._services).toEqual([]);
    });

    it('should reset input/output schemas after handle() is called', () => {
      const f = new FunctionBuilder();
      const inputSchema: any = { '~standard': { validate: () => ({}) } };
      const outputSchema: any = { '~standard': { validate: () => ({}) } };

      // First function with schemas
      const fn1 = f.input(inputSchema).output(outputSchema).handle(async () => ({}));

      // Second function should not have schemas
      const fn2 = f.handle(async () => ({}));

      expect(fn1.input).toBe(inputSchema);
      expect(fn1.outputSchema).toBe(outputSchema);
      expect(fn2.input).toBeUndefined();
      expect(fn2.outputSchema).toBeUndefined();
    });

    it('should reset timeout after handle() is called', () => {
      const f = new FunctionBuilder();

      // First function with custom timeout
      const fn1 = f.timeout(5000).handle(async () => ({}));

      // Second function should have default timeout (30000)
      const fn2 = f.handle(async () => ({}));

      expect(fn1.timeout).toBe(5000);
      expect(fn2.timeout).toBe(30000); // Default timeout
    });
  });

  describe('method chaining before handle()', () => {
    it('should accumulate services when chaining', () => {
      const f = new FunctionBuilder();

      const fn = f
        .services([ServiceA])
        .services([ServiceB])
        .handle(async () => ({}));

      expect(fn.services.map((s) => s.serviceName)).toEqual(['a', 'b']);
    });

    it('should not share references between different builder chains', () => {
      const f = new FunctionBuilder();

      // Start two separate chains
      const builder1 = f.services([ServiceA]);
      const builder2 = f.services([ServiceB]);

      // They should be the same instance (singleton)
      expect(builder1).toBe(builder2);
      expect(builder1).toBe(f);

      // But after handle, state is reset
      const fn1 = builder1.handle(async () => ({}));

      // Now builder2 should have reset state
      expect((builder2 as any)._services).toEqual([]);

      // Add services again
      const fn2 = builder2.services([ServiceB]).handle(async () => ({}));

      expect(fn1.services.map((s) => s.serviceName)).toEqual(['a', 'b']);
      expect(fn2.services.map((s) => s.serviceName)).toEqual(['b']);
    });
  });

  describe('sequential function creation', () => {
    it('should create independent functions sequentially', () => {
      const f = new FunctionBuilder();

      const fn1 = f.services([ServiceA, ServiceB]).handle(async () => ({ result: 1 }));
      const fn2 = f.services([ServiceA]).handle(async () => ({ result: 2 }));
      const fn3 = f.handle(async () => ({ result: 3 }));

      expect(fn1.services.map((s) => s.serviceName)).toEqual(['a', 'b']);
      expect(fn2.services.map((s) => s.serviceName)).toEqual(['a']);
      expect(fn3.services).toEqual([]);
    });
  });

  describe('publisher isolation', () => {
    it('should reset publisher after handle() is called', () => {
      const f = new FunctionBuilder();
      const mockPublisher: any = {
        serviceName: 'publisher',
        async register() {
          return { publish: () => {} };
        },
      };

      const fn1 = f.publisher(mockPublisher).handle(async () => ({}));
      const fn2 = f.handle(async () => ({}));

      expect((fn1 as any).publisherService).toBe(mockPublisher);
      expect((fn2 as any).publisherService).toBeUndefined();
    });
  });

  describe('auditor isolation', () => {
    const auditStorageService = {
      serviceName: 'auditStorage' as const,
      async register() {
        return new InMemoryAuditStorage();
      },
    } satisfies Service<'auditStorage', InMemoryAuditStorage>;

    it('should set auditor storage service', () => {
      const f = new FunctionBuilder();

      const fn1 = f.auditor(auditStorageService).handle(async () => ({}));

      expect((fn1 as any).auditorStorageService).toBe(auditStorageService);
    });

    it('should reset auditor storage after handle() is called', () => {
      const f = new FunctionBuilder();

      const fn1 = f.auditor(auditStorageService).handle(async () => ({}));
      const fn2 = f.handle(async () => ({}));

      expect((fn1 as any).auditorStorageService).toBe(auditStorageService);
      expect((fn2 as any).auditorStorageService).toBeUndefined();
    });
  });
});
