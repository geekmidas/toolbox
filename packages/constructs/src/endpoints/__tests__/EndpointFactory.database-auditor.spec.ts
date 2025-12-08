import type { AuditStorage } from '@geekmidas/audit';
import type { Logger } from '@geekmidas/logger';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EndpointFactory } from '../EndpointFactory';

describe('EndpointFactory', () => {
  const mockLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mockLogger),
  };

  describe('database', () => {
    const DatabaseService = {
      serviceName: 'database' as const,
      async register() {
        return {
          query: vi.fn().mockResolvedValue([]),
          insertInto: vi.fn(),
          selectFrom: vi.fn(),
        };
      },
    };

    it('should create a factory with database service', () => {
      const factory = new EndpointFactory();
      const factoryWithDb = factory.database(DatabaseService);

      expect(factoryWithDb).toBeInstanceOf(EndpointFactory);
      expect(factoryWithDb).not.toBe(factory);
    });

    it('should pass database service to created endpoints', () => {
      const factory = new EndpointFactory()
        .logger(mockLogger)
        .database(DatabaseService);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.databaseService).toBe(DatabaseService);
    });

    it('should preserve database service through factory chains', () => {
      const factory = new EndpointFactory()
        .database(DatabaseService)
        .logger(mockLogger)
        .route('/api');

      const endpoint = factory
        .get('/users')
        .handle(async () => ({ users: [] }));

      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.route).toBe('/api/users');
    });

    it('should preserve database service with services()', () => {
      const OtherService = {
        serviceName: 'other' as const,
        async register() {
          return {};
        },
      };

      const factory = new EndpointFactory()
        .database(DatabaseService)
        .services([OtherService]);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.services).toContainEqual(OtherService);
    });

    it('should allow endpoints to override database service', () => {
      const AlternativeDatabase = {
        serviceName: 'altDatabase' as const,
        async register() {
          return { query: vi.fn() };
        },
      };

      const factory = new EndpointFactory()
        .logger(mockLogger)
        .database(DatabaseService);

      const endpoint = factory
        .get('/test')
        .database(AlternativeDatabase)
        .handle(async () => ({ success: true }));

      expect(endpoint.databaseService).toBe(AlternativeDatabase);
    });

    it('should work with authorization and session', () => {
      const authFn = async () => true;
      const sessionFn = async () => ({ userId: '123' });

      const factory = new EndpointFactory()
        .database(DatabaseService)
        .authorize(authFn)
        .session(sessionFn);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.authorize).toBe(authFn);
      expect(endpoint.getSession).toBe(sessionFn);
    });
  });

  describe('auditor', () => {
    const mockAuditStorage: AuditStorage = {
      write: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    };

    const AuditStorageService = {
      serviceName: 'auditStorage' as const,
      async register() {
        return mockAuditStorage;
      },
    };

    it('should create a factory with auditor storage', () => {
      const factory = new EndpointFactory();
      const factoryWithAuditor = factory.auditor(AuditStorageService);

      expect(factoryWithAuditor).toBeInstanceOf(EndpointFactory);
      expect(factoryWithAuditor).not.toBe(factory);
    });

    it('should pass auditor storage to created endpoints', () => {
      const factory = new EndpointFactory()
        .logger(mockLogger)
        .auditor(AuditStorageService);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
    });

    it('should preserve auditor storage through factory chains', () => {
      const factory = new EndpointFactory()
        .auditor(AuditStorageService)
        .logger(mockLogger)
        .route('/api');

      const endpoint = factory
        .get('/users')
        .handle(async () => ({ users: [] }));

      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
      expect(endpoint.route).toBe('/api/users');
    });

    it('should preserve auditor storage with services()', () => {
      const OtherService = {
        serviceName: 'other' as const,
        async register() {
          return {};
        },
      };

      const factory = new EndpointFactory()
        .auditor(AuditStorageService)
        .services([OtherService]);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
      expect(endpoint.services).toContainEqual(OtherService);
    });

    it('should allow endpoints to override auditor storage', () => {
      const AlternativeAuditStorage = {
        serviceName: 'altAuditStorage' as const,
        async register(): Promise<AuditStorage> {
          return {
            write: vi.fn(),
            query: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
          };
        },
      };

      const factory = new EndpointFactory()
        .logger(mockLogger)
        .auditor(AuditStorageService);

      const endpoint = factory
        .get('/test')
        .auditor(AlternativeAuditStorage)
        .handle(async () => ({ success: true }));

      expect(endpoint.auditorStorageService).toBe(AlternativeAuditStorage);
    });

    it('should work with authorization and session', () => {
      const authFn = async () => true;
      const sessionFn = async () => ({ userId: '123' });

      const factory = new EndpointFactory()
        .auditor(AuditStorageService)
        .authorize(authFn)
        .session(sessionFn);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
      expect(endpoint.authorize).toBe(authFn);
      expect(endpoint.getSession).toBe(sessionFn);
    });
  });

  describe('database and auditor together', () => {
    const DatabaseService = {
      serviceName: 'database' as const,
      async register() {
        return { query: vi.fn() };
      },
    };

    const mockAuditStorage: AuditStorage = {
      write: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    };

    const AuditStorageService = {
      serviceName: 'auditStorage' as const,
      async register() {
        return mockAuditStorage;
      },
    };

    it('should allow both database and auditor to be configured', () => {
      const factory = new EndpointFactory()
        .logger(mockLogger)
        .database(DatabaseService)
        .auditor(AuditStorageService);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
    });

    it('should preserve both through route chains', () => {
      const factory = new EndpointFactory()
        .database(DatabaseService)
        .auditor(AuditStorageService)
        .route('/api')
        .route('/v1');

      const endpoint = factory
        .post('/users')
        .body(z.object({ name: z.string() }))
        .handle(async () => ({ id: '123' }));

      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
      expect(endpoint.route).toBe('/api/v1/users');
    });

    it('should work with all factory configuration options', () => {
      const authFn = async () => true;
      const sessionFn = async () => ({ userId: '123' });

      const OtherService = {
        serviceName: 'other' as const,
        async register() {
          return {};
        },
      };

      const factory = new EndpointFactory()
        .logger(mockLogger)
        .services([OtherService])
        .database(DatabaseService)
        .auditor(AuditStorageService)
        .authorize(authFn)
        .session(sessionFn)
        .route('/api');

      const endpoint = factory
        .post('/users')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string() }))
        .handle(async () => ({ id: '123' }));

      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
      expect(endpoint.authorize).toBe(authFn);
      expect(endpoint.getSession).toBe(sessionFn);
      expect(endpoint.services).toContainEqual(OtherService);
      expect(endpoint.route).toBe('/api/users');
    });

    it('should allow per-endpoint overrides of both', () => {
      const AltDatabase = {
        serviceName: 'altDb' as const,
        async register() {
          return { query: vi.fn() };
        },
      };

      const AltAuditStorage = {
        serviceName: 'altAudit' as const,
        async register(): Promise<AuditStorage> {
          return {
            write: vi.fn(),
            query: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
          };
        },
      };

      const factory = new EndpointFactory()
        .database(DatabaseService)
        .auditor(AuditStorageService);

      const endpoint = factory
        .get('/test')
        .database(AltDatabase)
        .auditor(AltAuditStorage)
        .handle(async () => ({ success: true }));

      expect(endpoint.databaseService).toBe(AltDatabase);
      expect(endpoint.auditorStorageService).toBe(AltAuditStorage);
    });
  });

  describe('actor', () => {
    it('should create a factory with actor extractor', () => {
      const actorExtractor = () => ({ id: '123', type: 'user' as const });
      const factory = new EndpointFactory();
      const factoryWithActor = factory.actor(actorExtractor);

      expect(factoryWithActor).toBeInstanceOf(EndpointFactory);
      expect(factoryWithActor).not.toBe(factory);
    });

    it('should pass actor extractor to created endpoints', () => {
      const actorExtractor = () => ({ id: '123', type: 'user' as const });
      const factory = new EndpointFactory()
        .logger(mockLogger)
        .actor(actorExtractor);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.actorExtractor).toBe(actorExtractor);
    });

    it('should preserve actor extractor through factory chains', () => {
      const actorExtractor = () => ({ id: '123', type: 'user' as const });
      const factory = new EndpointFactory()
        .actor(actorExtractor)
        .logger(mockLogger)
        .route('/api');

      const endpoint = factory
        .get('/users')
        .handle(async () => ({ users: [] }));

      expect(endpoint.actorExtractor).toBe(actorExtractor);
      expect(endpoint.route).toBe('/api/users');
    });

    it('should allow endpoints to override actor extractor', () => {
      const factoryActor = () => ({ id: 'factory', type: 'system' as const });
      const endpointActor = () => ({ id: 'endpoint', type: 'user' as const });

      const factory = new EndpointFactory()
        .logger(mockLogger)
        .actor(factoryActor);

      const endpoint = factory
        .get('/test')
        .actor(endpointActor)
        .handle(async () => ({ success: true }));

      expect(endpoint.actorExtractor).toBe(endpointActor);
    });

    it('should work with auditor and database', () => {
      const actorExtractor = ({ session }: any) => ({
        id: session.userId,
        type: 'user' as const,
      });

      const mockAuditStorage: AuditStorage = {
        write: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      };

      const AuditStorageService = {
        serviceName: 'auditStorage' as const,
        async register() {
          return mockAuditStorage;
        },
      };

      const DatabaseService = {
        serviceName: 'database' as const,
        async register() {
          return { query: vi.fn() };
        },
      };

      const factory = new EndpointFactory()
        .logger(mockLogger)
        .database(DatabaseService)
        .auditor(AuditStorageService)
        .actor(actorExtractor);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.actorExtractor).toBe(actorExtractor);
      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
    });
  });

  describe('constructor options with database and auditor', () => {
    const DatabaseService = {
      serviceName: 'database' as const,
      async register() {
        return { query: vi.fn() };
      },
    };

    const mockAuditStorage: AuditStorage = {
      write: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    };

    const AuditStorageService = {
      serviceName: 'auditStorage' as const,
      async register() {
        return mockAuditStorage;
      },
    };

    it('should accept database and auditor in constructor options', () => {
      const factory = new EndpointFactory({
        defaultDatabaseService: DatabaseService,
        defaultAuditorStorage: AuditStorageService,
      });

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.auditorStorageService).toBe(AuditStorageService);
    });

    it('should merge constructor options with method calls', () => {
      const AltAuditStorage = {
        serviceName: 'altAudit' as const,
        async register(): Promise<AuditStorage> {
          return {
            write: vi.fn(),
            query: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
          };
        },
      };

      const factory = new EndpointFactory({
        defaultDatabaseService: DatabaseService,
      }).auditor(AltAuditStorage);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.databaseService).toBe(DatabaseService);
      expect(endpoint.auditorStorageService).toBe(AltAuditStorage);
    });
  });
});
