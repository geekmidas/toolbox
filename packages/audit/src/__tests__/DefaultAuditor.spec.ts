import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultAuditor } from '../DefaultAuditor';
import type { AuditStorage } from '../storage';
import type { AuditableAction, AuditRecord } from '../types';

// Define test audit actions
type TestAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'order.placed', { orderId: string; total: number }>;

describe('DefaultAuditor', () => {
  let storage: AuditStorage;
  let writtenRecords: AuditRecord[];

  beforeEach(() => {
    writtenRecords = [];
    storage = {
      write: vi.fn(async (records: AuditRecord[]) => {
        writtenRecords.push(...records);
      }),
    };
  });

  describe('constructor', () => {
    it('should set actor from config', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      expect(auditor.actor).toEqual({ id: 'user-123', type: 'user' });
    });

    it('should use custom ID generator when provided', () => {
      let counter = 0;
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => `custom-${++counter}`,
      });

      auditor.audit('user.created', {
        userId: '123',
        email: 'test@example.com',
      });
      auditor.audit('user.updated', { userId: '123', changes: ['name'] });

      const records = auditor.getRecords();
      expect(records[0].id).toBe('custom-1');
      expect(records[1].id).toBe('custom-2');
    });
  });

  describe('audit', () => {
    it('should create audit record with type and payload', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => 'test-id',
      });

      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });

      const records = auditor.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: 'test-id',
        type: 'user.created',
        operation: 'CUSTOM',
        payload: { userId: '456', email: 'test@example.com' },
        actor: { id: 'user-123', type: 'user' },
      });
      expect(records[0].timestamp).toBeInstanceOf(Date);
    });

    it('should include options in audit record', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => 'test-id',
      });

      auditor.audit(
        'user.updated',
        { userId: '456', changes: ['email', 'name'] },
        {
          operation: 'UPDATE',
          table: 'users',
          entityId: '456',
          oldValues: { email: 'old@example.com' },
          newValues: { email: 'new@example.com' },
        },
      );

      const records = auditor.getRecords();
      expect(records[0]).toMatchObject({
        type: 'user.updated',
        operation: 'UPDATE',
        table: 'users',
        entityId: '456',
        oldValues: { email: 'old@example.com' },
        newValues: { email: 'new@example.com' },
      });
    });

    it('should include metadata from config', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        metadata: { requestId: 'req-789', endpoint: '/users' },
        generateId: () => 'test-id',
      });

      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });

      const records = auditor.getRecords();
      expect(records[0].metadata).toEqual({
        requestId: 'req-789',
        endpoint: '/users',
      });
    });
  });

  describe('record', () => {
    it('should create raw audit record', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => 'test-id',
      });

      auditor.record({
        type: 'custom.event',
        operation: 'CUSTOM',
        payload: { custom: 'data' },
      });

      const records = auditor.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: 'test-id',
        type: 'custom.event',
        operation: 'CUSTOM',
        payload: { custom: 'data' },
        actor: { id: 'user-123', type: 'user' },
      });
    });

    it('should merge metadata from config and record', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        metadata: { requestId: 'req-789', endpoint: '/users' },
        generateId: () => 'test-id',
      });

      auditor.record({
        type: 'custom.event',
        operation: 'CUSTOM',
        metadata: { custom: 'value', endpoint: '/custom' },
      });

      const records = auditor.getRecords();
      expect(records[0].metadata).toEqual({
        requestId: 'req-789',
        endpoint: '/custom', // Record metadata overrides config
        custom: 'value',
      });
    });

    it('should use record metadata when no config metadata', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => 'test-id',
      });

      auditor.record({
        type: 'custom.event',
        operation: 'CUSTOM',
        metadata: { custom: 'value' },
      });

      const records = auditor.getRecords();
      expect(records[0].metadata).toEqual({ custom: 'value' });
    });
  });

  describe('getRecords', () => {
    it('should return copy of records', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });

      const records1 = auditor.getRecords();
      const records2 = auditor.getRecords();

      expect(records1).not.toBe(records2);
      expect(records1).toEqual(records2);
    });

    it('should return empty array when no records', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      expect(auditor.getRecords()).toEqual([]);
    });
  });

  describe('flush', () => {
    it('should write records to storage', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => 'test-id',
      });

      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });
      auditor.audit('order.placed', { orderId: 'order-789', total: 99.99 });

      await auditor.flush();

      expect(storage.write).toHaveBeenCalledTimes(1);
      expect(writtenRecords).toHaveLength(2);
      expect(writtenRecords[0].type).toBe('user.created');
      expect(writtenRecords[1].type).toBe('order.placed');
    });

    it('should pass transaction to storage', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });

      const mockTrx = { isTrx: true };
      await auditor.flush(mockTrx);

      expect(storage.write).toHaveBeenCalledWith(expect.any(Array), mockTrx);
    });

    it('should clear records after flush', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });
      await auditor.flush();

      expect(auditor.getRecords()).toEqual([]);
    });

    it('should do nothing when no records to flush', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      await auditor.flush();

      expect(storage.write).not.toHaveBeenCalled();
    });

    it('should handle multiple flushes', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      auditor.audit('user.created', {
        userId: '1',
        email: 'first@example.com',
      });
      await auditor.flush();

      auditor.audit('user.created', {
        userId: '2',
        email: 'second@example.com',
      });
      await auditor.flush();

      expect(storage.write).toHaveBeenCalledTimes(2);
      expect(writtenRecords).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('should remove all records without flushing', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });
      auditor.audit('order.placed', { orderId: 'order-789', total: 99.99 });

      auditor.clear();

      expect(auditor.getRecords()).toEqual([]);
      expect(storage.write).not.toHaveBeenCalled();
    });
  });

  describe('type safety', () => {
    it('should enforce correct payload types', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      // These should compile without errors
      auditor.audit('user.created', {
        userId: '123',
        email: 'test@example.com',
      });
      auditor.audit('user.updated', { userId: '123', changes: ['name'] });
      auditor.audit('order.placed', { orderId: 'order-1', total: 50.0 });

      // TypeScript would catch these at compile time:
      // auditor.audit('user.created', { orderId: '123' }); // Wrong payload
      // auditor.audit('unknown.type', {}); // Unknown type

      expect(auditor.getRecords()).toHaveLength(3);
    });
  });

  describe('addMetadata', () => {
    it('should add metadata when none exists', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => 'test-id',
      });

      auditor.addMetadata({ requestId: 'req-123', endpoint: '/users' });
      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });

      const records = auditor.getRecords();
      expect(records[0].metadata).toEqual({
        requestId: 'req-123',
        endpoint: '/users',
      });
    });

    it('should merge with existing metadata', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        metadata: { requestId: 'req-123' },
        generateId: () => 'test-id',
      });

      auditor.addMetadata({ endpoint: '/users', method: 'POST' });
      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });

      const records = auditor.getRecords();
      expect(records[0].metadata).toEqual({
        requestId: 'req-123',
        endpoint: '/users',
        method: 'POST',
      });
    });

    it('should override existing metadata values', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        metadata: { requestId: 'old-req', endpoint: '/old' },
        generateId: () => 'test-id',
      });

      auditor.addMetadata({ endpoint: '/new', ip: '192.168.1.1' });
      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });

      const records = auditor.getRecords();
      expect(records[0].metadata).toEqual({
        requestId: 'old-req',
        endpoint: '/new',
        ip: '192.168.1.1',
      });
    });

    it('should apply to all future audits', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => 'test-id',
      });

      // Audit before adding metadata
      auditor.audit('user.created', {
        userId: '1',
        email: 'first@example.com',
      });

      // Add metadata
      auditor.addMetadata({ requestId: 'req-123' });

      // Audit after adding metadata
      auditor.audit('user.created', {
        userId: '2',
        email: 'second@example.com',
      });

      const records = auditor.getRecords();
      expect(records[0].metadata).toBeUndefined();
      expect(records[1].metadata).toEqual({ requestId: 'req-123' });
    });

    it('should allow multiple addMetadata calls', () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        generateId: () => 'test-id',
      });

      auditor.addMetadata({ requestId: 'req-123' });
      auditor.addMetadata({ endpoint: '/users' });
      auditor.addMetadata({ method: 'POST' });
      auditor.audit('user.created', {
        userId: '456',
        email: 'test@example.com',
      });

      const records = auditor.getRecords();
      expect(records[0].metadata).toEqual({
        requestId: 'req-123',
        endpoint: '/users',
        method: 'POST',
      });
    });
  });
});
