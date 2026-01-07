import type {
  AuditableAction,
  AuditRecord,
  AuditStorage,
} from '@geekmidas/audit';
import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ActorExtractor, MappedAudit } from '../audit';
import { EndpointBuilder } from '../EndpointBuilder';

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

const auditStorageService = {
  serviceName: 'auditStorage' as const,
  async register() {
    return new InMemoryAuditStorage();
  },
} satisfies Service<'auditStorage', InMemoryAuditStorage>;

// Define test audit actions
type TestAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'user.deleted', { userId: string }>;

describe('EndpointBuilder audit methods', () => {
  describe('auditor', () => {
    it('should set auditor storage service', () => {
      const builder = new EndpointBuilder('/users', 'POST').auditor(
        auditStorageService,
      );

      expect((builder as any)._auditorStorage).toBe(auditStorageService);
    });

    it('should return builder for chaining', () => {
      const builder = new EndpointBuilder('/users', 'POST');
      const result = builder.auditor(auditStorageService);

      expect(result).toBe(builder);
    });

    it('should pass auditor storage service to endpoint', () => {
      const endpoint = new EndpointBuilder('/users', 'POST')
        .auditor(auditStorageService)
        .handle(async () => ({ id: '123' }));

      expect(endpoint.auditorStorageService).toBe(auditStorageService);
    });

    it('should allow chaining with other methods', () => {
      const bodySchema = z.object({ name: z.string() });
      const outputSchema = z.object({ id: z.string() });

      const endpoint = new EndpointBuilder('/users', 'POST')
        .body(bodySchema)
        .output(outputSchema)
        .auditor(auditStorageService)
        .status(201)
        .handle(async () => ({ id: '123' }));

      expect(endpoint.auditorStorageService).toBe(auditStorageService);
      expect(endpoint.input?.body).toBe(bodySchema);
      expect(endpoint.outputSchema).toBe(outputSchema);
      expect(endpoint.status).toBe(201);
    });
  });

  describe('actor', () => {
    it('should set actor extractor function', () => {
      const actorExtractor: ActorExtractor = ({ session }) => ({
        id: (session as any)?.userId ?? 'anonymous',
        type: 'user',
      });

      const builder = new EndpointBuilder('/users', 'POST').actor(
        actorExtractor,
      );

      expect((builder as any)._actorExtractor).toBe(actorExtractor);
    });

    it('should return builder for chaining', () => {
      const builder = new EndpointBuilder('/users', 'POST');
      const result = builder.actor(() => ({ id: '123', type: 'user' }));

      expect(result).toBe(builder);
    });

    it('should pass actor extractor to endpoint', () => {
      const actorExtractor: ActorExtractor = ({ header }) => ({
        id: header('x-user-id') ?? 'anonymous',
        type: 'user',
        ip: header('x-forwarded-for'),
      });

      const endpoint = new EndpointBuilder('/users', 'POST')
        .auditor(auditStorageService)
        .actor(actorExtractor)
        .handle(async () => ({ id: '123' }));

      expect(endpoint.actorExtractor).toBe(actorExtractor);
    });

    it('should work with async actor extractor', () => {
      const asyncActorExtractor: ActorExtractor = async ({ services }) => {
        // Simulate async lookup
        await Promise.resolve();
        return { id: 'async-user', type: 'user' };
      };

      const endpoint = new EndpointBuilder('/users', 'POST')
        .auditor(auditStorageService)
        .actor(asyncActorExtractor)
        .handle(async () => ({ id: '123' }));

      expect(endpoint.actorExtractor).toBe(asyncActorExtractor);
    });

    it('should allow chaining auditor and actor in any order', () => {
      const actorExtractor: ActorExtractor = () => ({
        id: '123',
        type: 'user',
      });

      // auditor then actor
      const endpoint1 = new EndpointBuilder('/users', 'POST')
        .auditor(auditStorageService)
        .actor(actorExtractor)
        .handle(async () => ({ id: '123' }));

      // actor then auditor
      const endpoint2 = new EndpointBuilder('/users', 'POST')
        .actor(actorExtractor)
        .auditor(auditStorageService)
        .handle(async () => ({ id: '123' }));

      expect(endpoint1.auditorStorageService).toBe(auditStorageService);
      expect(endpoint1.actorExtractor).toBe(actorExtractor);
      expect(endpoint2.auditorStorageService).toBe(auditStorageService);
      expect(endpoint2.actorExtractor).toBe(actorExtractor);
    });
  });

  describe('audit', () => {
    it('should set declarative audit definitions', () => {
      const outputSchema = z.object({
        id: z.string(),
        email: z.string(),
        active: z.boolean(),
      });

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
        },
      ];

      const builder = new EndpointBuilder('/users', 'POST')
        .output(outputSchema)
        .audit<TestAuditAction>(audits);

      expect((builder as any)._audits).toBe(audits);
    });

    it('should return builder for chaining', () => {
      const builder = new EndpointBuilder('/users', 'POST');
      const result = builder.audit([]);

      expect(result).toBe(builder);
    });

    it('should pass audit definitions to endpoint', () => {
      const outputSchema = z.object({
        id: z.string(),
        email: z.string(),
        active: z.boolean(),
      });

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
          when: (response) => response.active,
          entityId: (response) => response.id,
          table: 'users',
        },
      ];

      const endpoint = new EndpointBuilder('/users', 'POST')
        .output(outputSchema)
        .auditor(auditStorageService)
        .audit<TestAuditAction>(audits)
        .handle(async () => ({
          id: '123',
          email: 'test@test.com',
          active: true,
        }));

      expect(endpoint.audits).toBe(audits);
    });

    it('should support multiple audit definitions', () => {
      const outputSchema = z.object({
        id: z.string(),
        email: z.string(),
        changes: z.array(z.string()),
      });

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
        },
        {
          type: 'user.updated',
          payload: (response) => ({
            userId: response.id,
            changes: response.changes,
          }),
          when: (response) => response.changes.length > 0,
        },
      ];

      const endpoint = new EndpointBuilder('/users', 'POST')
        .output(outputSchema)
        .auditor(auditStorageService)
        .audit<TestAuditAction>(audits)
        .handle(async () => ({
          id: '123',
          email: 'test@test.com',
          changes: ['name'],
        }));

      expect(endpoint.audits).toHaveLength(2);
      expect(endpoint.audits[0].type).toBe('user.created');
      expect(endpoint.audits[1].type).toBe('user.updated');
    });

    it('should support conditional audits with when function', () => {
      const outputSchema = z.object({
        id: z.string(),
        email: z.string(),
        active: z.boolean(),
      });

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
          when: (response) => response.active,
        },
      ];

      const endpoint = new EndpointBuilder('/users', 'POST')
        .output(outputSchema)
        .audit<TestAuditAction>(audits)
        .handle(async () => ({
          id: '123',
          email: 'test@test.com',
          active: true,
        }));

      // Verify the when function works
      const whenFn = endpoint.audits[0].when!;
      expect(whenFn({ id: '1', email: 'a@b.com', active: true })).toBe(true);
      expect(whenFn({ id: '1', email: 'a@b.com', active: false })).toBe(false);
    });

    it('should support entityId extraction', () => {
      const outputSchema = z.object({
        id: z.string(),
        email: z.string(),
      });

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
          entityId: (response) => response.id,
        },
      ];

      const endpoint = new EndpointBuilder('/users', 'POST')
        .output(outputSchema)
        .audit<TestAuditAction>(audits)
        .handle(async () => ({ id: '123', email: 'test@test.com' }));

      const entityIdFn = endpoint.audits[0].entityId!;
      expect(entityIdFn({ id: 'user-456', email: 'a@b.com' })).toBe('user-456');
    });

    it('should support composite entityId', () => {
      const outputSchema = z.object({
        id: z.string(),
        orgId: z.string(),
        email: z.string(),
      });

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
          entityId: (response) => ({
            userId: response.id,
            orgId: response.orgId,
          }),
        },
      ];

      const endpoint = new EndpointBuilder('/users', 'POST')
        .output(outputSchema)
        .audit<TestAuditAction>(audits)
        .handle(async () => ({
          id: '123',
          orgId: 'org-1',
          email: 'test@test.com',
        }));

      const entityIdFn = endpoint.audits[0].entityId!;
      expect(entityIdFn({ id: 'u-1', orgId: 'o-1', email: 'a@b.com' })).toEqual(
        {
          userId: 'u-1',
          orgId: 'o-1',
        },
      );
    });
  });

  describe('full audit chain', () => {
    it('should support complete audit configuration', () => {
      const outputSchema = z.object({
        id: z.string(),
        email: z.string(),
        active: z.boolean(),
      });

      const actorExtractor: ActorExtractor = ({ session, header }) => ({
        id: (session as any)?.userId ?? 'anonymous',
        type: 'user',
        ip: header('x-forwarded-for'),
      });

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
          when: (response) => response.active,
          entityId: (response) => response.id,
          table: 'users',
        },
      ];

      const endpoint = new EndpointBuilder('/users', 'POST')
        .output(outputSchema)
        .auditor(auditStorageService)
        .actor(actorExtractor)
        .audit<TestAuditAction>(audits)
        .handle(async () => ({
          id: '123',
          email: 'test@test.com',
          active: true,
        }));

      expect(endpoint.auditorStorageService).toBe(auditStorageService);
      expect(endpoint.actorExtractor).toBe(actorExtractor);
      expect(endpoint.audits).toBe(audits);
      expect(endpoint.audits[0].table).toBe('users');
    });

    it('should work without actor extractor', () => {
      const outputSchema = z.object({ id: z.string(), email: z.string() });

      const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
        },
      ];

      const endpoint = new EndpointBuilder('/users', 'POST')
        .output(outputSchema)
        .auditor(auditStorageService)
        .audit<TestAuditAction>(audits)
        .handle(async () => ({ id: '123', email: 'test@test.com' }));

      expect(endpoint.auditorStorageService).toBe(auditStorageService);
      expect(endpoint.actorExtractor).toBeUndefined();
      expect(endpoint.audits).toBe(audits);
    });

    it('should work without audit definitions (imperative auditing only)', () => {
      const endpoint = new EndpointBuilder('/users', 'POST')
        .auditor(auditStorageService)
        .actor(() => ({ id: '123', type: 'user' }))
        .handle(async () => ({ id: '123' }));

      expect(endpoint.auditorStorageService).toBe(auditStorageService);
      expect(endpoint.actorExtractor).toBeDefined();
      expect(endpoint.audits).toEqual([]);
    });

    it('should default to empty audits array', () => {
      const endpoint = new EndpointBuilder('/users', 'GET').handle(
        async () => ({}),
      );

      expect(endpoint.audits).toEqual([]);
    });
  });
});
