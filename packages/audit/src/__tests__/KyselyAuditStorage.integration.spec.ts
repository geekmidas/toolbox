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
} from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../testkit/test/globalSetup';
import { DefaultAuditor } from '../DefaultAuditor';
import { KyselyAuditStorage, type AuditLogTable } from '../kysely';
import type { AuditableAction } from '../types';

interface TestDatabase {
  auditLogs: AuditLogTable;
  users: {
    id: Generated<number>;
    name: string;
    email: string;
  };
}

// Define test audit actions
type TestAuditAction =
  | AuditableAction<'user.created', { userId: number; email: string }>
  | AuditableAction<'user.updated', { userId: number; changes: string[] }>
  | AuditableAction<'user.deleted', { userId: number }>;

describe('KyselyAuditStorage Integration Tests', () => {
  let db: Kysely<TestDatabase>;
  let storage: KyselyAuditStorage<TestDatabase>;

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

    // Create users table for testing audit integration
    await db.schema
      .createTable('users')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('email', 'varchar', (col) => col.notNull().unique())
      .execute();

    storage = new KyselyAuditStorage({
      db,
      tableName: 'auditLogs',
    });
  });

  afterEach(async () => {
    // Clean up data after each test
    await db.deleteFrom('auditLogs').execute();
    await db.deleteFrom('users').execute();
  });

  afterAll(async () => {
    // Drop tables and close connection
    await db.schema.dropTable('auditLogs').ifExists().execute();
    await db.schema.dropTable('users').ifExists().execute();
    await db.destroy();
  });

  describe('write', () => {
    it('should write audit records to database', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
        metadata: { requestId: 'req-456' },
      });

      auditor.audit('user.created', { userId: 1, email: 'test@example.com' });

      await auditor.flush();

      // Verify record was written
      const records = await db
        .selectFrom('auditLogs')
        .selectAll()
        .execute();

      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('user.created');
      expect(records[0].actorId).toBe('user-123');
      expect(records[0].actorType).toBe('user');
      expect(records[0].payload).toEqual({
        userId: 1,
        email: 'test@example.com',
      });
      expect(records[0].metadata).toEqual({
        requestId: 'req-456',
      });
    });

    it('should write multiple audit records in batch', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'admin-1', type: 'admin' },
        storage,
      });

      auditor.audit('user.created', { userId: 1, email: 'user1@example.com' });
      auditor.audit('user.created', { userId: 2, email: 'user2@example.com' });
      auditor.audit('user.updated', { userId: 1, changes: ['name'] });

      await auditor.flush();

      const records = await db
        .selectFrom('auditLogs')
        .selectAll()
        .orderBy('timestamp', 'asc')
        .execute();

      expect(records).toHaveLength(3);
      expect(records.map((r) => r.type)).toEqual([
        'user.created',
        'user.created',
        'user.updated',
      ]);
    });

    it('should write audit records within transaction', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      await db.transaction().execute(async (trx) => {
        // Insert user
        const user = await trx
          .insertInto('users')
          .values({ name: 'Test User', email: 'test@example.com' })
          .returningAll()
          .executeTakeFirstOrThrow();

        // Audit the creation
        auditor.audit(
          'user.created',
          { userId: user.id, email: user.email },
          { entityId: String(user.id), table: 'users', operation: 'INSERT' },
        );

        // Flush within transaction
        await auditor.flush(trx);
      });

      // Verify both user and audit record exist
      const users = await db.selectFrom('users').selectAll().execute();
      const audits = await db.selectFrom('auditLogs').selectAll().execute();

      expect(users).toHaveLength(1);
      expect(audits).toHaveLength(1);
      expect(audits[0].entityId).toBe(String(users[0].id));
      expect(audits[0].table).toBe('users');
      expect(audits[0].operation).toBe('INSERT');
    });

    it('should rollback audit records when transaction fails', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-123', type: 'user' },
        storage,
      });

      const transactionPromise = db.transaction().execute(async (trx) => {
        // Insert user
        const user = await trx
          .insertInto('users')
          .values({ name: 'Rollback User', email: 'rollback@example.com' })
          .returningAll()
          .executeTakeFirstOrThrow();

        // Audit the creation
        auditor.audit('user.created', { userId: user.id, email: user.email });

        // Flush within transaction
        await auditor.flush(trx);

        // Throw error to rollback
        throw new Error('Transaction should rollback');
      });

      await expect(transactionPromise).rejects.toThrow(
        'Transaction should rollback',
      );

      // Verify both user and audit record were rolled back
      const users = await db.selectFrom('users').selectAll().execute();
      const audits = await db.selectFrom('auditLogs').selectAll().execute();

      expect(users).toHaveLength(0);
      expect(audits).toHaveLength(0);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Insert test audit records
      const auditor1 = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-1', type: 'user' },
        storage,
        metadata: { endpoint: '/users' },
      });

      const auditor2 = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'admin-1', type: 'admin' },
        storage,
        metadata: { endpoint: '/admin/users' },
      });

      auditor1.audit(
        'user.created',
        { userId: 1, email: 'user1@example.com' },
        { entityId: '1', table: 'users' },
      );
      auditor1.audit(
        'user.updated',
        { userId: 1, changes: ['name'] },
        { entityId: '1', table: 'users' },
      );
      auditor2.audit(
        'user.deleted',
        { userId: 2 },
        { entityId: '2', table: 'users' },
      );

      await auditor1.flush();
      await auditor2.flush();
    });

    it('should query all records', async () => {
      const records = await storage.query({});

      expect(records).toHaveLength(3);
    });

    it('should filter by type', async () => {
      const records = await storage.query({ type: 'user.created' });

      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('user.created');
    });

    it('should filter by multiple types', async () => {
      const records = await storage.query({
        type: ['user.created', 'user.updated'],
      });

      expect(records).toHaveLength(2);
    });

    it('should filter by actorId', async () => {
      const records = await storage.query({ actorId: 'admin-1' });

      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('user.deleted');
    });

    it('should filter by entityId', async () => {
      const records = await storage.query({ entityId: '1' });

      expect(records).toHaveLength(2);
    });

    it('should filter by table', async () => {
      const records = await storage.query({ table: 'users' });

      expect(records).toHaveLength(3);
    });

    it('should apply pagination', async () => {
      const page1 = await storage.query({ limit: 2, offset: 0 });
      const page2 = await storage.query({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });

    it('should order by timestamp descending by default', async () => {
      const records = await storage.query({});

      // Records should be in descending order (newest first)
      for (let i = 1; i < records.length; i++) {
        expect(records[i - 1].timestamp.getTime()).toBeGreaterThanOrEqual(
          records[i].timestamp.getTime(),
        );
      }
    });

    it('should order by type ascending', async () => {
      const records = await storage.query({
        orderBy: 'type',
        orderDirection: 'asc',
      });

      const types = records.map((r) => r.type);
      expect(types).toEqual([...types].sort());
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-1', type: 'user' },
        storage,
      });

      auditor.audit('user.created', { userId: 1, email: 'user1@example.com' });
      auditor.audit('user.created', { userId: 2, email: 'user2@example.com' });
      auditor.audit('user.updated', { userId: 1, changes: ['name'] });

      await auditor.flush();
    });

    it('should count all records', async () => {
      const count = await storage.count({});

      expect(count).toBe(3);
    });

    it('should count with type filter', async () => {
      const count = await storage.count({ type: 'user.created' });

      expect(count).toBe(2);
    });

    it('should count with actorId filter', async () => {
      const count = await storage.count({ actorId: 'user-1' });

      expect(count).toBe(3);
    });
  });

  describe('complex scenarios', () => {
    it('should handle audit trail for user lifecycle', async () => {
      // Create user
      const createAuditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'admin-1', type: 'admin' },
        storage,
        metadata: { endpoint: '/users', method: 'POST' },
      });

      const user = await db
        .insertInto('users')
        .values({ name: 'John Doe', email: 'john@example.com' })
        .returningAll()
        .executeTakeFirstOrThrow();

      createAuditor.audit(
        'user.created',
        { userId: user.id, email: user.email },
        {
          entityId: String(user.id),
          table: 'users',
          operation: 'INSERT',
          newValues: { name: 'John Doe', email: 'john@example.com' },
        },
      );
      await createAuditor.flush();

      // Update user
      const updateAuditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-1', type: 'user' },
        storage,
        metadata: { endpoint: '/users/1', method: 'PATCH' },
      });

      await db
        .updateTable('users')
        .set({ name: 'John Smith' })
        .where('id', '=', user.id)
        .execute();

      updateAuditor.audit(
        'user.updated',
        { userId: user.id, changes: ['name'] },
        {
          entityId: String(user.id),
          table: 'users',
          operation: 'UPDATE',
          oldValues: { name: 'John Doe' },
          newValues: { name: 'John Smith' },
        },
      );
      await updateAuditor.flush();

      // Delete user
      const deleteAuditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'admin-1', type: 'admin' },
        storage,
        metadata: { endpoint: '/users/1', method: 'DELETE' },
      });

      await db.deleteFrom('users').where('id', '=', user.id).execute();

      deleteAuditor.audit(
        'user.deleted',
        { userId: user.id },
        {
          entityId: String(user.id),
          table: 'users',
          operation: 'DELETE',
          oldValues: { name: 'John Smith', email: 'john@example.com' },
        },
      );
      await deleteAuditor.flush();

      // Query audit trail for this user
      const auditTrail = await storage.query({
        entityId: String(user.id),
        orderDirection: 'asc',
      });

      expect(auditTrail).toHaveLength(3);
      expect(auditTrail.map((r) => r.type)).toEqual([
        'user.created',
        'user.updated',
        'user.deleted',
      ]);
      expect(auditTrail.map((r) => r.operation)).toEqual([
        'INSERT',
        'UPDATE',
        'DELETE',
      ]);

      // Verify old/new values tracking
      expect(auditTrail[1].oldValues).toEqual({ name: 'John Doe' });
      expect(auditTrail[1].newValues).toEqual({ name: 'John Smith' });
    });

    it('should handle complex entity IDs', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: { id: 'user-1', type: 'user' },
        storage,
      });

      // Record with composite entity ID
      auditor.record({
        type: 'relation.created',
        operation: 'INSERT',
        entityId: { userId: 1, roleId: 'admin' },
        table: 'user_roles',
        payload: { granted: true },
      });

      await auditor.flush();

      // Query by composite entity ID
      const records = await storage.query({
        entityId: { userId: 1, roleId: 'admin' },
      });

      expect(records).toHaveLength(1);
      expect(records[0].entityId).toEqual({ userId: 1, roleId: 'admin' });
    });

    it('should preserve actor extra properties', async () => {
      const auditor = new DefaultAuditor<TestAuditAction>({
        actor: {
          id: 'user-1',
          type: 'user',
          email: 'user@example.com',
          roles: ['admin', 'editor'],
        },
        storage,
      });

      auditor.audit('user.created', { userId: 1, email: 'new@example.com' });
      await auditor.flush();

      const records = await storage.query({});

      expect(records[0].actor).toEqual({
        id: 'user-1',
        type: 'user',
        email: 'user@example.com',
        roles: ['admin', 'editor'],
      });
    });
  });
});
