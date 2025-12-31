import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAuditStorage } from '../memory';
import type { AuditRecord } from '../types';

describe('InMemoryAuditStorage', () => {
  let storage: InMemoryAuditStorage;

  beforeEach(() => {
    storage = new InMemoryAuditStorage();
  });

  describe('write', () => {
    it('should write records to memory', async () => {
      const records: AuditRecord[] = [
        {
          id: 'audit-1',
          type: 'user.created',
          operation: 'INSERT',
          table: 'users',
          entityId: 'user-123',
          payload: { email: 'test@example.com' },
          timestamp: new Date('2024-01-01T00:00:00Z'),
          actor: { id: 'admin-1', type: 'admin' },
          metadata: { requestId: 'req-123' },
        },
      ];

      await storage.write(records);

      const stored = await storage.getRecords();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        id: 'audit-1',
        type: 'user.created',
        entityId: 'user-123',
      });
    });

    it('should append multiple records', async () => {
      const record1: AuditRecord = {
        id: 'audit-1',
        type: 'user.created',
        operation: 'INSERT',
        timestamp: new Date('2024-01-01T00:00:00Z'),
      };
      const record2: AuditRecord = {
        id: 'audit-2',
        type: 'user.updated',
        operation: 'UPDATE',
        timestamp: new Date('2024-01-02T00:00:00Z'),
      };

      await storage.write([record1]);
      await storage.write([record2]);

      const stored = await storage.getRecords();
      expect(stored).toHaveLength(2);
    });

    it('should do nothing for empty records', async () => {
      await storage.write([]);

      const records = await storage.getRecords();
      expect(records).toHaveLength(0);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await storage.write([
        {
          id: 'audit-1',
          type: 'user.created',
          operation: 'INSERT',
          table: 'users',
          entityId: 'user-123',
          payload: { email: 'test@example.com' },
          timestamp: new Date('2024-01-01T00:00:00Z'),
          actor: { id: 'admin-1', type: 'admin' },
        },
        {
          id: 'audit-2',
          type: 'user.updated',
          operation: 'UPDATE',
          table: 'users',
          entityId: 'user-123',
          timestamp: new Date('2024-01-02T00:00:00Z'),
          actor: { id: 'admin-1', type: 'admin' },
        },
        {
          id: 'audit-3',
          type: 'order.placed',
          operation: 'INSERT',
          table: 'orders',
          entityId: 'order-456',
          timestamp: new Date('2024-01-03T00:00:00Z'),
          actor: { id: 'user-1', type: 'user' },
        },
      ]);
    });

    it('should return all records when no filters', async () => {
      const results = await storage.query({});
      expect(results).toHaveLength(3);
    });

    it('should filter by type (string)', async () => {
      const results = await storage.query({ type: 'user.created' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('audit-1');
    });

    it('should filter by type (array)', async () => {
      const results = await storage.query({
        type: ['user.created', 'user.updated'],
      });
      expect(results).toHaveLength(2);
    });

    it('should filter by entityId (string)', async () => {
      const results = await storage.query({ entityId: 'user-123' });
      expect(results).toHaveLength(2);
    });

    it('should filter by entityId (object)', async () => {
      await storage.write([
        {
          id: 'audit-4',
          type: 'relation.created',
          operation: 'INSERT',
          entityId: { userId: 'u1', roleId: 'r1' },
          timestamp: new Date('2024-01-04T00:00:00Z'),
        },
      ]);

      const results = await storage.query({
        entityId: { userId: 'u1', roleId: 'r1' },
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('audit-4');
    });

    it('should filter by table', async () => {
      const results = await storage.query({ table: 'users' });
      expect(results).toHaveLength(2);
    });

    it('should filter by actorId', async () => {
      const results = await storage.query({ actorId: 'user-1' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('audit-3');
    });

    it('should filter by date range (from)', async () => {
      const results = await storage.query({
        from: new Date('2024-01-02T00:00:00Z'),
      });
      expect(results).toHaveLength(2);
    });

    it('should filter by date range (to)', async () => {
      const results = await storage.query({
        to: new Date('2024-01-02T00:00:00Z'),
      });
      expect(results).toHaveLength(2);
    });

    it('should filter by date range (from and to)', async () => {
      const results = await storage.query({
        from: new Date('2024-01-02T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('audit-2');
    });

    it('should apply pagination (limit)', async () => {
      const results = await storage.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should apply pagination (offset)', async () => {
      const results = await storage.query({ offset: 1 });
      expect(results).toHaveLength(2);
    });

    it('should apply pagination (limit and offset)', async () => {
      const results = await storage.query({ limit: 1, offset: 1 });
      expect(results).toHaveLength(1);
    });

    it('should order by timestamp desc by default', async () => {
      const results = await storage.query({});
      expect(results[0].id).toBe('audit-3'); // Most recent first
      expect(results[2].id).toBe('audit-1'); // Oldest last
    });

    it('should order by timestamp asc', async () => {
      const results = await storage.query({
        orderBy: 'timestamp',
        orderDirection: 'asc',
      });
      expect(results[0].id).toBe('audit-1'); // Oldest first
      expect(results[2].id).toBe('audit-3'); // Most recent last
    });

    it('should order by type', async () => {
      const results = await storage.query({
        orderBy: 'type',
        orderDirection: 'asc',
      });
      expect(results[0].type).toBe('order.placed');
      expect(results[2].type).toBe('user.updated');
    });

    it('should combine multiple filters', async () => {
      const results = await storage.query({
        table: 'users',
        actorId: 'admin-1',
      });
      expect(results).toHaveLength(2);
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      await storage.write([
        {
          id: 'audit-1',
          type: 'user.created',
          operation: 'INSERT',
          timestamp: new Date(),
          actor: { id: 'admin-1', type: 'admin' },
        },
        {
          id: 'audit-2',
          type: 'user.updated',
          operation: 'UPDATE',
          timestamp: new Date(),
          actor: { id: 'admin-1', type: 'admin' },
        },
        {
          id: 'audit-3',
          type: 'order.placed',
          operation: 'INSERT',
          timestamp: new Date(),
          actor: { id: 'user-1', type: 'user' },
        },
      ]);
    });

    it('should count all records', async () => {
      const count = await storage.count({});
      expect(count).toBe(3);
    });

    it('should count with type filter', async () => {
      const count = await storage.count({ type: 'user.created' });
      expect(count).toBe(1);
    });

    it('should count with actor filter', async () => {
      const count = await storage.count({ actorId: 'admin-1' });
      expect(count).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all records', async () => {
      await storage.write([
        {
          id: 'audit-1',
          type: 'test',
          operation: 'CUSTOM',
          timestamp: new Date(),
        },
        {
          id: 'audit-2',
          type: 'test',
          operation: 'CUSTOM',
          timestamp: new Date(),
        },
      ]);

      let records = await storage.getRecords();
      expect(records).toHaveLength(2);

      await storage.clear();

      records = await storage.getRecords();
      expect(records).toHaveLength(0);
    });
  });

  describe('type safety', () => {
    it('should support generic audit action types', async () => {
      type AppAuditAction =
        | { type: 'user.created'; payload: { userId: string } }
        | { type: 'order.placed'; payload: { orderId: string } };

      const typedStorage = new InMemoryAuditStorage<AppAuditAction>();

      await typedStorage.write([
        {
          id: 'audit-1',
          type: 'user.created',
          operation: 'CUSTOM',
          timestamp: new Date(),
          payload: { userId: '123' },
        },
      ]);

      const records = await typedStorage.getRecords();
      expect(records).toHaveLength(1);
    });
  });
});
