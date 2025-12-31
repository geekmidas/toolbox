import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogLevel } from '../types';
import { DEFAULT_REDACT_PATHS } from '../pino';

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

  describe('Redaction', () => {
    it('should not configure redaction when redact is undefined', async () => {
      const { createLogger } = await import('../pino');

      createLogger({});

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact).toBeUndefined();
    });

    it('should not configure redaction when redact is false', async () => {
      const { createLogger } = await import('../pino');

      createLogger({ redact: false });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact).toBeUndefined();
    });

    it('should use default redact paths when redact is true', async () => {
      const { createLogger } = await import('../pino');

      createLogger({ redact: true });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact).toEqual(DEFAULT_REDACT_PATHS);
    });

    it('should merge custom paths with defaults when redact is an array', async () => {
      const { createLogger } = await import('../pino');
      const customPaths = ['custom.field', 'user.ssn'];

      createLogger({ redact: customPaths });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      // Should include both defaults and custom paths
      expect(callArgs.redact).toEqual([
        ...DEFAULT_REDACT_PATHS,
        ...customPaths,
      ]);
    });

    it('should merge object config paths with defaults by default', async () => {
      const { createLogger } = await import('../pino');
      const customPaths = ['custom.field'];

      createLogger({
        redact: {
          paths: customPaths,
          censor: '***HIDDEN***',
        },
      });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact.paths).toEqual([
        ...DEFAULT_REDACT_PATHS,
        ...customPaths,
      ]);
      expect(callArgs.redact.censor).toBe('***HIDDEN***');
    });

    it('should override defaults when resolution is override', async () => {
      const { createLogger } = await import('../pino');
      const customPaths = ['only.this.path'];

      createLogger({
        redact: {
          paths: customPaths,
          resolution: 'override',
        },
      });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact.paths).toEqual(customPaths);
      // Should not include defaults
      expect(callArgs.redact.paths).not.toContain('password');
    });

    it('should merge with defaults when resolution is merge', async () => {
      const { createLogger } = await import('../pino');
      const customPaths = ['extra.secret'];

      createLogger({
        redact: {
          paths: customPaths,
          resolution: 'merge',
        },
      });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact.paths).toEqual([
        ...DEFAULT_REDACT_PATHS,
        ...customPaths,
      ]);
    });

    it('should support remove option in redact config', async () => {
      const { createLogger } = await import('../pino');

      createLogger({
        redact: {
          paths: ['temp.data'],
          remove: true,
        },
      });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact.remove).toBe(true);
    });

    it('should support censor function in redact config', async () => {
      const { createLogger } = await import('../pino');
      const censorFn = () => '***';

      createLogger({
        redact: {
          paths: ['secret'],
          censor: censorFn,
        },
      });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact.censor).toBe(censorFn);
    });

    it('should not include resolution field in pino config', async () => {
      const { createLogger } = await import('../pino');

      createLogger({
        redact: {
          paths: ['secret'],
          resolution: 'override',
        },
      });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.redact).not.toHaveProperty('resolution');
    });

    it('should combine redact with other options', async () => {
      const { createLogger } = await import('../pino');

      createLogger({
        level: LogLevel.Debug,
        redact: true,
      });

      const callArgs = pinoMock.mock.calls[pinoMock.mock.calls.length - 1][0];
      expect(callArgs.level).toBe(LogLevel.Debug);
      expect(callArgs.redact).toEqual(DEFAULT_REDACT_PATHS);
    });
  });

  describe('DEFAULT_REDACT_PATHS', () => {
    it('should include common password fields', () => {
      expect(DEFAULT_REDACT_PATHS).toContain('password');
      expect(DEFAULT_REDACT_PATHS).toContain('pass');
      expect(DEFAULT_REDACT_PATHS).toContain('passwd');
    });

    it('should include token fields', () => {
      expect(DEFAULT_REDACT_PATHS).toContain('token');
      expect(DEFAULT_REDACT_PATHS).toContain('accessToken');
      expect(DEFAULT_REDACT_PATHS).toContain('refreshToken');
      expect(DEFAULT_REDACT_PATHS).toContain('idToken');
    });

    it('should include API key variations', () => {
      expect(DEFAULT_REDACT_PATHS).toContain('apiKey');
      expect(DEFAULT_REDACT_PATHS).toContain('api_key');
      expect(DEFAULT_REDACT_PATHS).toContain('apikey');
    });

    it('should include authorization headers', () => {
      expect(DEFAULT_REDACT_PATHS).toContain('headers.authorization');
      expect(DEFAULT_REDACT_PATHS).toContain('headers.Authorization');
      expect(DEFAULT_REDACT_PATHS).toContain('headers.cookie');
    });

    it('should include wildcard patterns for nested fields', () => {
      expect(DEFAULT_REDACT_PATHS).toContain('*.password');
      expect(DEFAULT_REDACT_PATHS).toContain('*.secret');
      expect(DEFAULT_REDACT_PATHS).toContain('*.token');
    });

    it('should include sensitive personal data fields', () => {
      expect(DEFAULT_REDACT_PATHS).toContain('ssn');
      expect(DEFAULT_REDACT_PATHS).toContain('creditCard');
      expect(DEFAULT_REDACT_PATHS).toContain('cardNumber');
      expect(DEFAULT_REDACT_PATHS).toContain('cvv');
    });

    it('should include database connection strings', () => {
      expect(DEFAULT_REDACT_PATHS).toContain('connectionString');
      expect(DEFAULT_REDACT_PATHS).toContain('databaseUrl');
    });
  });
});
