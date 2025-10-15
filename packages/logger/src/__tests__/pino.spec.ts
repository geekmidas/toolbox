import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogLevel } from '../types';

// Mock pino module
vi.mock('pino', () => ({
  pino: vi.fn((options) => ({
    _options: options,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  })),
}));

describe('Pino Logger', () => {
  let pinoMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const pinoModule = await import('pino');
    pinoMock = pinoModule.pino;
  });

  describe('createLogger', () => {
    it('should create pino logger with default options', async () => {
      const { createLogger } = await import('../pino');

      const logger = createLogger({});

      expect(pinoMock).toHaveBeenCalled();
      expect(logger).toBeDefined();
    });

    it('should create logger with pretty formatting in development', async () => {
      const { createLogger } = await import('../pino');
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      createLogger({ pretty: true });

      expect(pinoMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: {
            target: 'pino-pretty',
            options: { colorize: true },
          },
        }),
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should not use pretty formatting when pretty is false', async () => {
      const { createLogger } = await import('../pino');

      createLogger({ pretty: false });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.transport).toBeUndefined();
    });

    it('should configure formatters', async () => {
      const { createLogger } = await import('../pino');

      createLogger({});

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.formatters).toBeDefined();
      expect(callArgs.formatters.bindings).toBeInstanceOf(Function);
      expect(callArgs.formatters.level).toBeInstanceOf(Function);
    });

    it('should format bindings with node version', async () => {
      const { createLogger } = await import('../pino');

      createLogger({});

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      const bindings = callArgs.formatters.bindings();

      expect(bindings).toEqual({
        nodeVersion: process.version,
      });
    });

    it('should format level labels to uppercase', async () => {
      const { createLogger } = await import('../pino');

      createLogger({});

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      const levelFormatter = callArgs.formatters.level;

      expect(levelFormatter('info')).toEqual({ level: 'INFO' });
      expect(levelFormatter('debug')).toEqual({ level: 'DEBUG' });
      expect(levelFormatter('error')).toEqual({ level: 'ERROR' });
      expect(levelFormatter('warn')).toEqual({ level: 'WARN' });
    });

    it('should accept log level option', async () => {
      const { createLogger } = await import('../pino');

      const logger = createLogger({ level: LogLevel.Debug });

      expect(logger).toBeDefined();
      // Note: The actual level setting depends on pino's implementation
    });

    it('should handle undefined options', async () => {
      const { createLogger } = await import('../pino');

      const logger = createLogger({});

      expect(logger).toBeDefined();
      expect(pinoMock).toHaveBeenCalled();
    });
  });

  describe('Logger options', () => {
    it('should support pretty option', async () => {
      const { createLogger } = await import('../pino');

      const logger1 = createLogger({ pretty: true });
      const logger2 = createLogger({ pretty: false });

      expect(logger1).toBeDefined();
      expect(logger2).toBeDefined();
    });

    it('should support level option', async () => {
      const { createLogger } = await import('../pino');

      const logger1 = createLogger({ level: LogLevel.Info });
      const logger2 = createLogger({ level: LogLevel.Debug });
      const logger3 = createLogger({ level: LogLevel.Error });

      expect(logger1).toBeDefined();
      expect(logger2).toBeDefined();
      expect(logger3).toBeDefined();
    });

    it('should support combined options', async () => {
      const { createLogger } = await import('../pino');

      const logger = createLogger({
        pretty: true,
        level: LogLevel.Debug,
      });

      expect(logger).toBeDefined();
      expect(pinoMock).toHaveBeenCalled();
    });
  });
});
