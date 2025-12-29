import { beforeEach, describe, expect, it } from 'vitest';
import type { ExceptionEntry, LogEntry, RequestEntry } from '../../types';
import { InMemoryStorage } from '../memory';

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  describe('requests', () => {
    const createRequest = (
      overrides: Partial<RequestEntry> = {},
    ): RequestEntry => ({
      id: `req-${Math.random().toString(36).slice(2)}`,
      method: 'GET',
      path: '/api/users',
      url: 'http://localhost:3000/api/users',
      headers: { 'content-type': 'application/json' },
      query: {},
      status: 200,
      responseHeaders: {},
      duration: 50,
      timestamp: new Date(),
      ...overrides,
    });

    it('should save and retrieve a request', async () => {
      const request = createRequest({ id: 'req-123' });
      await storage.saveRequest(request);

      const retrieved = await storage.getRequest('req-123');
      expect(retrieved).toEqual(request);
    });

    it('should return null for non-existent request', async () => {
      const result = await storage.getRequest('non-existent');
      expect(result).toBeNull();
    });

    it('should list requests in reverse chronological order', async () => {
      const req1 = createRequest({
        id: 'req-1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
      });
      const req2 = createRequest({
        id: 'req-2',
        timestamp: new Date('2024-01-01T11:00:00Z'),
      });
      const req3 = createRequest({
        id: 'req-3',
        timestamp: new Date('2024-01-01T12:00:00Z'),
      });

      await storage.saveRequest(req1);
      await storage.saveRequest(req2);
      await storage.saveRequest(req3);

      const requests = await storage.getRequests();
      expect(requests.map((r) => r.id)).toEqual(['req-3', 'req-2', 'req-1']);
    });

    it('should respect limit and offset options', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.saveRequest(
          createRequest({
            id: `req-${i}`,
            timestamp: new Date(Date.now() + i * 1000),
          }),
        );
      }

      const page1 = await storage.getRequests({ limit: 3, offset: 0 });
      expect(page1).toHaveLength(3);
      expect(page1[0].id).toBe('req-9');

      const page2 = await storage.getRequests({ limit: 3, offset: 3 });
      expect(page2).toHaveLength(3);
      expect(page2[0].id).toBe('req-6');
    });

    it('should filter by search term in path', async () => {
      await storage.saveRequest(
        createRequest({
          id: 'req-1',
          path: '/api/users',
          url: 'http://localhost/api/users',
        }),
      );
      await storage.saveRequest(
        createRequest({
          id: 'req-2',
          path: '/api/posts',
          url: 'http://localhost/api/posts',
        }),
      );
      await storage.saveRequest(
        createRequest({
          id: 'req-3',
          path: '/api/orders',
          url: 'http://localhost/api/orders',
        }),
      );

      const results = await storage.getRequests({ search: 'posts' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('req-2');
    });

    it('should filter by date range', async () => {
      await storage.saveRequest(
        createRequest({ id: 'req-1', timestamp: new Date('2024-01-01') }),
      );
      await storage.saveRequest(
        createRequest({ id: 'req-2', timestamp: new Date('2024-01-15') }),
      );
      await storage.saveRequest(
        createRequest({ id: 'req-3', timestamp: new Date('2024-02-01') }),
      );

      const results = await storage.getRequests({
        after: new Date('2024-01-10'),
        before: new Date('2024-01-20'),
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('req-2');
    });

    it('should filter by tags', async () => {
      await storage.saveRequest(
        createRequest({ id: 'req-1', tags: ['auth', 'api'] }),
      );
      await storage.saveRequest(createRequest({ id: 'req-2', tags: ['api'] }));
      await storage.saveRequest(
        createRequest({ id: 'req-3', tags: ['admin'] }),
      );

      const results = await storage.getRequests({ tags: ['auth'] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('req-1');
    });

    it('should enforce maxEntries limit', async () => {
      const smallStorage = new InMemoryStorage({ maxEntries: 5 });

      for (let i = 0; i < 10; i++) {
        await smallStorage.saveRequest(
          createRequest({
            id: `req-${i}`,
            timestamp: new Date(Date.now() + i * 1000),
          }),
        );
      }

      const requests = await smallStorage.getRequests();
      expect(requests).toHaveLength(5);
      // Should keep the newest entries
      expect(requests[0].id).toBe('req-9');
      expect(requests[4].id).toBe('req-5');
    });
  });

  describe('exceptions', () => {
    const createException = (
      overrides: Partial<ExceptionEntry> = {},
    ): ExceptionEntry => ({
      id: `exc-${Math.random().toString(36).slice(2)}`,
      name: 'Error',
      message: 'Something went wrong',
      stack: [
        {
          file: '/app/src/index.ts',
          line: 10,
          column: 5,
          function: 'main',
          isApp: true,
        },
      ],
      timestamp: new Date(),
      handled: false,
      ...overrides,
    });

    it('should save and retrieve an exception', async () => {
      const exception = createException({ id: 'exc-123' });
      await storage.saveException(exception);

      const retrieved = await storage.getException('exc-123');
      expect(retrieved).toEqual(exception);
    });

    it('should return null for non-existent exception', async () => {
      const result = await storage.getException('non-existent');
      expect(result).toBeNull();
    });

    it('should list exceptions in reverse chronological order', async () => {
      await storage.saveException(
        createException({
          id: 'exc-1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
      );
      await storage.saveException(
        createException({
          id: 'exc-2',
          timestamp: new Date('2024-01-01T11:00:00Z'),
        }),
      );

      const exceptions = await storage.getExceptions();
      expect(exceptions.map((e) => e.id)).toEqual(['exc-2', 'exc-1']);
    });

    it('should filter exceptions by search term in message', async () => {
      await storage.saveException(
        createException({ id: 'exc-1', message: 'Database connection failed' }),
      );
      await storage.saveException(
        createException({ id: 'exc-2', message: 'Invalid user input' }),
      );

      const results = await storage.getExceptions({ search: 'database' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('exc-1');
    });
  });

  describe('logs', () => {
    const createLog = (overrides: Partial<LogEntry> = {}): LogEntry => ({
      id: `log-${Math.random().toString(36).slice(2)}`,
      level: 'info',
      message: 'Test log message',
      timestamp: new Date(),
      ...overrides,
    });

    it('should save and retrieve logs', async () => {
      await storage.saveLog(createLog({ id: 'log-1', message: 'First log' }));
      await storage.saveLog(createLog({ id: 'log-2', message: 'Second log' }));

      const logs = await storage.getLogs();
      expect(logs).toHaveLength(2);
    });

    it('should filter logs by level via search', async () => {
      await storage.saveLog(createLog({ id: 'log-1', level: 'debug' }));
      await storage.saveLog(createLog({ id: 'log-2', level: 'error' }));
      await storage.saveLog(createLog({ id: 'log-3', level: 'error' }));

      const results = await storage.getLogs({ search: 'error' });
      expect(results).toHaveLength(2);
    });

    it('should include context in logs', async () => {
      await storage.saveLog(
        createLog({
          id: 'log-1',
          context: { userId: '123', action: 'login' },
        }),
      );

      const logs = await storage.getLogs();
      expect(logs[0].context).toEqual({ userId: '123', action: 'login' });
    });
  });

  describe('prune', () => {
    it('should remove entries older than specified date', async () => {
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-06-01');

      await storage.saveRequest({
        id: 'req-old',
        method: 'GET',
        path: '/old',
        url: 'http://localhost/old',
        headers: {},
        query: {},
        status: 200,
        responseHeaders: {},
        duration: 10,
        timestamp: oldDate,
      });

      await storage.saveRequest({
        id: 'req-new',
        method: 'GET',
        path: '/new',
        url: 'http://localhost/new',
        headers: {},
        query: {},
        status: 200,
        responseHeaders: {},
        duration: 10,
        timestamp: newDate,
      });

      await storage.saveException({
        id: 'exc-old',
        name: 'Error',
        message: 'Old error',
        stack: [],
        timestamp: oldDate,
        handled: false,
      });

      await storage.saveLog({
        id: 'log-old',
        level: 'info',
        message: 'Old log',
        timestamp: oldDate,
      });

      const pruneDate = new Date('2024-03-01');
      const deleted = await storage.prune(pruneDate);

      expect(deleted).toBe(3);

      const requests = await storage.getRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].id).toBe('req-new');

      const exceptions = await storage.getExceptions();
      expect(exceptions).toHaveLength(0);

      const logs = await storage.getLogs();
      expect(logs).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await storage.saveRequest({
        id: 'req-1',
        method: 'GET',
        path: '/api',
        url: 'http://localhost/api',
        headers: {},
        query: {},
        status: 200,
        responseHeaders: {},
        duration: 10,
        timestamp: new Date(),
      });

      await storage.saveException({
        id: 'exc-1',
        name: 'Error',
        message: 'Test',
        stack: [],
        timestamp: new Date(),
        handled: false,
      });

      await storage.saveLog({
        id: 'log-1',
        level: 'info',
        message: 'Test',
        timestamp: new Date(),
      });
      await storage.saveLog({
        id: 'log-2',
        level: 'error',
        message: 'Test',
        timestamp: new Date(),
      });

      const stats = await storage.getStats();

      expect(stats.requests).toBe(1);
      expect(stats.exceptions).toBe(1);
      expect(stats.logs).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      await storage.saveRequest({
        id: 'req-1',
        method: 'GET',
        path: '/api',
        url: 'http://localhost/api',
        headers: {},
        query: {},
        status: 200,
        responseHeaders: {},
        duration: 10,
        timestamp: new Date(),
      });

      await storage.saveException({
        id: 'exc-1',
        name: 'Error',
        message: 'Test',
        stack: [],
        timestamp: new Date(),
        handled: false,
      });

      storage.clear();

      const stats = await storage.getStats();
      expect(stats.requests).toBe(0);
      expect(stats.exceptions).toBe(0);
      expect(stats.logs).toBe(0);
    });
  });
});
