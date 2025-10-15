import type { Kysely, Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { type DatabaseConnection, withTransaction } from '../kysely';

describe('Kysely Transaction Helper', () => {
  describe('withTransaction', () => {
    it('should execute callback within new transaction for Kysely instance', async () => {
      const executeSpy = vi.fn(async (cb) => {
        const mockTrx = { isTransaction: true } as Transaction<any>;
        return cb(mockTrx);
      });

      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(() => ({
          execute: executeSpy,
        })),
      } as unknown as Kysely<any>;

      const callback = vi.fn(async (trx) => {
        expect(trx.isTransaction).toBe(true);
        return 'result';
      });

      const result = await withTransaction(mockDb, callback);

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(result).toBe('result');
    });

    it('should reuse existing transaction', async () => {
      const mockTrx = {
        isTransaction: true,
      } as Transaction<any>;

      const callback = vi.fn(async (trx) => {
        expect(trx).toBe(mockTrx);
        return 'reused';
      });

      const result = await withTransaction(mockTrx, callback);

      expect(callback).toHaveBeenCalledWith(mockTrx);
      expect(result).toBe('reused');
    });

    it('should handle ControlledTransaction by reusing it', async () => {
      const mockControlledTrx = {
        isTransaction: true,
      } as any; // ControlledTransaction

      const callback = vi.fn(async (trx) => {
        return 'controlled';
      });

      const result = await withTransaction(mockControlledTrx, callback);

      expect(callback).toHaveBeenCalledWith(mockControlledTrx);
      expect(result).toBe('controlled');
    });

    it('should propagate callback return value', async () => {
      const executeSpy = vi.fn(async (cb) => {
        const mockTrx = { isTransaction: true } as Transaction<any>;
        return cb(mockTrx);
      });

      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(() => ({
          execute: executeSpy,
        })),
      } as unknown as Kysely<any>;

      const result = await withTransaction(mockDb, async () => {
        return { id: 123, name: 'Test' };
      });

      expect(result).toEqual({ id: 123, name: 'Test' });
    });

    it('should propagate errors from callback', async () => {
      const executeSpy = vi.fn(async (cb) => {
        const mockTrx = { isTransaction: true } as Transaction<any>;
        return cb(mockTrx);
      });

      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(() => ({
          execute: executeSpy,
        })),
      } as unknown as Kysely<any>;

      const error = new Error('Transaction failed');

      await expect(
        withTransaction(mockDb, async () => {
          throw error;
        }),
      ).rejects.toThrow('Transaction failed');
    });

    it('should allow nested transactions with reuse', async () => {
      const outerExecuteSpy = vi.fn(async (cb) => {
        const mockTrx = { isTransaction: true } as Transaction<any>;
        return cb(mockTrx);
      });

      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(() => ({
          execute: outerExecuteSpy,
        })),
      } as unknown as Kysely<any>;

      const result = await withTransaction(mockDb, async (outerTrx) => {
        // Inner call should reuse the transaction
        return withTransaction(outerTrx, async (innerTrx) => {
          expect(innerTrx).toBe(outerTrx);
          return 'nested';
        });
      });

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(result).toBe('nested');
    });

    it('should work with database queries', async () => {
      const executeSpy = vi.fn(async (cb) => {
        const mockTrx = {
          isTransaction: true,
          selectFrom: vi.fn(() => ({
            selectAll: vi.fn(() => ({
              execute: vi.fn(async () => [
                { id: 1, name: 'User 1' },
                { id: 2, name: 'User 2' },
              ]),
            })),
          })),
        } as unknown as Transaction<any>;
        return cb(mockTrx);
      });

      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(() => ({
          execute: executeSpy,
        })),
      } as unknown as Kysely<any>;

      const result = await withTransaction(mockDb, async (trx) => {
        const users = await (trx as any)
          .selectFrom('users')
          .selectAll()
          .execute();
        return users;
      });

      expect(result).toEqual([
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' },
      ]);
    });

    it('should handle async operations in callback', async () => {
      const executeSpy = vi.fn(async (cb) => {
        const mockTrx = { isTransaction: true } as Transaction<any>;
        return cb(mockTrx);
      });

      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(() => ({
          execute: executeSpy,
        })),
      } as unknown as Kysely<any>;

      const result = await withTransaction(mockDb, async (trx) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async-result';
      });

      expect(result).toBe('async-result');
    });

    it('should support different return types', async () => {
      const executeSpy = vi.fn(async (cb) => {
        const mockTrx = { isTransaction: true } as Transaction<any>;
        return cb(mockTrx);
      });

      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(() => ({
          execute: executeSpy,
        })),
      } as unknown as Kysely<any>;

      // Number
      const numResult = await withTransaction(mockDb, async () => 42);
      expect(numResult).toBe(42);

      // String
      const strResult = await withTransaction(mockDb, async () => 'test');
      expect(strResult).toBe('test');

      // Boolean
      const boolResult = await withTransaction(mockDb, async () => true);
      expect(boolResult).toBe(true);

      // Array
      const arrResult = await withTransaction(mockDb, async () => [1, 2, 3]);
      expect(arrResult).toEqual([1, 2, 3]);

      // Object
      const objResult = await withTransaction(mockDb, async () => ({
        key: 'value',
      }));
      expect(objResult).toEqual({ key: 'value' });
    });

    it('should maintain transaction isolation', async () => {
      const executeSpy = vi.fn(async (cb) => {
        const mockTrx = {
          isTransaction: true,
          id: 'trx-123',
        } as unknown as Transaction<any>;
        return cb(mockTrx);
      });

      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(() => ({
          execute: executeSpy,
        })),
      } as unknown as Kysely<any>;

      await withTransaction(mockDb, async (trx1) => {
        expect((trx1 as any).id).toBe('trx-123');

        // Nested transaction reuses same transaction
        await withTransaction(trx1, async (trx2) => {
          expect(trx2).toBe(trx1);
          expect((trx2 as any).id).toBe('trx-123');
        });
      });
    });
  });

  describe('DatabaseConnection type', () => {
    it('should accept Kysely instance', () => {
      const mockDb = {
        isTransaction: false,
        transaction: vi.fn(),
      } as unknown as DatabaseConnection<any>;

      expect(mockDb).toBeDefined();
    });

    it('should accept Transaction instance', () => {
      const mockTrx = {
        isTransaction: true,
      } as unknown as DatabaseConnection<any>;

      expect(mockTrx).toBeDefined();
    });

    it('should accept ControlledTransaction instance', () => {
      const mockControlledTrx = {
        isTransaction: true,
      } as unknown as DatabaseConnection<any>;

      expect(mockControlledTrx).toBeDefined();
    });
  });
});
