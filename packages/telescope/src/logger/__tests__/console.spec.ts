import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Telescope } from '../../Telescope';
import { InMemoryStorage } from '../../storage/memory';
import { TelescopeLogger, createTelescopeLogger } from '../console';
import type { Logger } from '../console';

describe('TelescopeLogger', () => {
  let telescope: Telescope;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    telescope = new Telescope({ storage });
  });

  afterEach(() => {
    telescope.destroy();
  });

  describe('without underlying logger', () => {
    it('should log to Telescope only', async () => {
      const logger = new TelescopeLogger({ telescope });

      logger.info({ userId: '123' }, 'User logged in');

      // Wait for async log
      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('User logged in');
      expect(logs[0].context).toEqual({ userId: '123' });
    });

    it('should handle string-only logging', async () => {
      const logger = new TelescopeLogger({ telescope });

      logger.debug('Simple debug message');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs[0].message).toBe('Simple debug message');
      expect(logs[0].level).toBe('debug');
    });
  });

  describe('with underlying logger', () => {
    it('should forward logs to both Telescope and underlying logger', async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => mockLogger),
      };

      const logger = new TelescopeLogger({ telescope, logger: mockLogger });

      logger.info({ action: 'test' }, 'Test message');

      expect(mockLogger.info).toHaveBeenCalledWith(
        { action: 'test' },
        'Test message',
      );

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
    });

    it('should forward string-only logs to underlying logger', async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => mockLogger),
      };

      const logger = new TelescopeLogger({ telescope, logger: mockLogger });

      logger.warn('Warning message');

      expect(mockLogger.warn).toHaveBeenCalledWith('Warning message');
    });
  });

  describe('log levels', () => {
    it('should support all log levels', async () => {
      const logger = new TelescopeLogger({ telescope });

      logger.debug({}, 'Debug');
      logger.info({}, 'Info');
      logger.warn({}, 'Warn');
      logger.error({}, 'Error');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(4);

      const levels = logs.map((l) => l.level);
      expect(levels).toContain('debug');
      expect(levels).toContain('info');
      expect(levels).toContain('warn');
      expect(levels).toContain('error');
    });

    it('should map fatal to error level for Telescope', async () => {
      const logger = new TelescopeLogger({ telescope });

      logger.fatal({}, 'Fatal error');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs[0].level).toBe('error');
      expect(logs[0].context).toEqual({ level: 'fatal' });
    });

    it('should map trace to debug level for Telescope', async () => {
      const logger = new TelescopeLogger({ telescope });

      logger.trace({}, 'Trace message');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs[0].level).toBe('debug');
      expect(logs[0].context).toEqual({ level: 'trace' });
    });
  });

  describe('child loggers', () => {
    it('should create child logger with inherited context', async () => {
      const logger = new TelescopeLogger({
        telescope,
        context: { app: 'myApp' },
      });

      const childLogger = logger.child({ module: 'auth' });
      childLogger.info({}, 'Child log');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs[0].context).toEqual({ app: 'myApp', module: 'auth' });
    });

    it('should create child of underlying logger too', async () => {
      const childMock: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => childMock),
      };

      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => childMock),
      };

      const logger = new TelescopeLogger({ telescope, logger: mockLogger });
      const child = logger.child({ module: 'test' });

      expect(mockLogger.child).toHaveBeenCalledWith({ module: 'test' });

      child.info({}, 'Test');
      expect(childMock.info).toHaveBeenCalled();
    });
  });

  describe('withRequestId', () => {
    it('should bind logs to a request ID', async () => {
      const logger = new TelescopeLogger({ telescope });
      const requestLogger = logger.withRequestId('req-123');

      requestLogger.info({}, 'Request log');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs[0].requestId).toBe('req-123');
    });

    it('should preserve context when binding request ID', async () => {
      const logger = new TelescopeLogger({
        telescope,
        context: { app: 'test' },
      });
      const requestLogger = logger.withRequestId('req-456');

      requestLogger.info({ action: 'test' }, 'Log');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs[0].context).toEqual({ app: 'test', action: 'test' });
      expect(logs[0].requestId).toBe('req-456');
    });
  });

  describe('createTelescopeLogger factory', () => {
    it('should create logger without underlying logger', async () => {
      const logger = createTelescopeLogger(telescope);

      logger.info({}, 'Factory test');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
    });

    it('should create logger with underlying logger', async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => mockLogger),
      };

      const logger = createTelescopeLogger(telescope, mockLogger);

      logger.error({ err: 'test' }, 'Error message');

      expect(mockLogger.error).toHaveBeenCalled();

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
    });

    it('should create logger with initial context', async () => {
      const logger = createTelescopeLogger(telescope, undefined, {
        service: 'api',
      });

      logger.info({}, 'With context');

      await new Promise((r) => setTimeout(r, 10));

      const logs = await telescope.getLogs();
      expect(logs[0].context).toEqual({ service: 'api' });
    });
  });
});
