import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Telescope } from '../../Telescope';
import { InMemoryStorage } from '../../storage/memory';
import { createPinoDestination, createPinoTransport } from '../pino';

describe('Pino Transport', () => {
  let telescope: Telescope;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    telescope = new Telescope({ storage });
  });

  afterEach(() => {
    telescope.destroy();
  });

  // Helper to create transport with fast flush for tests
  const createTestTransport = (
    opts: Parameters<typeof createPinoTransport>[0],
  ) => createPinoTransport({ flushIntervalMs: 50, ...opts });

  describe('createPinoTransport', () => {
    it('should parse and forward JSON log lines', async () => {
      const transport = createTestTransport({ telescope });
      const logger = pino({ level: 'debug' }, transport);

      logger.info({ userId: '123' }, 'Test message');

      // Wait for flush interval
      await new Promise((r) => setTimeout(r, 100));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('Test message');
      expect(logs[0].context).toMatchObject({ userId: '123' });
    });

    it('should map Pino log levels correctly', async () => {
      const transport = createTestTransport({ telescope });
      const logger = pino({ level: 'trace' }, transport);

      logger.trace('Trace message');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');
      logger.fatal('Fatal message');

      await new Promise((r) => setTimeout(r, 150));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(6);

      const logLevels = logs.map((l) => l.level);
      expect(logLevels.filter((l) => l === 'debug')).toHaveLength(2); // trace + debug
      expect(logLevels).toContain('info');
      expect(logLevels).toContain('warn');
      expect(logLevels.filter((l) => l === 'error')).toHaveLength(2); // error + fatal
    });

    it('should extract requestId from log data', async () => {
      const transport = createTestTransport({ telescope });
      const logger = pino({ level: 'debug' }, transport);

      logger.info({ requestId: 'req-abc123' }, 'Request log');

      await new Promise((r) => setTimeout(r, 100));

      const logs = await telescope.getLogs();
      expect(logs[0].requestId).toBe('req-abc123');
      // requestId should not be in context
      expect(logs[0].context).not.toHaveProperty('requestId');
    });

    it('should use static requestId option', async () => {
      const transport = createTestTransport({
        telescope,
        requestId: 'static-req-id',
      });
      const logger = pino({ level: 'debug' }, transport);

      logger.info('Log with static ID');

      await new Promise((r) => setTimeout(r, 100));

      const logs = await telescope.getLogs();
      expect(logs[0].requestId).toBe('static-req-id');
    });

    it('should use requestId function option', async () => {
      const transport = createTestTransport({
        telescope,
        requestId: (data) => data.traceId as string | undefined,
      });
      const logger = pino({ level: 'debug' }, transport);

      logger.info({ traceId: 'trace-xyz' }, 'Log with extracted ID');

      await new Promise((r) => setTimeout(r, 100));

      const logs = await telescope.getLogs();
      expect(logs[0].requestId).toBe('trace-xyz');
    });

    it('should handle empty message', async () => {
      const transport = createTestTransport({ telescope });
      const logger = pino({ level: 'debug' }, transport);

      logger.info({ data: 'some data' });

      await new Promise((r) => setTimeout(r, 100));

      const logs = await telescope.getLogs();
      expect(logs[0].message).toBe('');
    });

    it('should strip Pino metadata from context', async () => {
      const transport = createTestTransport({ telescope });
      const logger = pino({ level: 'debug' }, transport);

      logger.info({ customField: 'value' }, 'Test');

      await new Promise((r) => setTimeout(r, 100));

      const logs = await telescope.getLogs();
      const context = logs[0].context;

      expect(context).not.toHaveProperty('level');
      expect(context).not.toHaveProperty('msg');
      expect(context).not.toHaveProperty('time');
      expect(context).not.toHaveProperty('pid');
      expect(context).not.toHaveProperty('hostname');
      expect(context).toMatchObject({ customField: 'value' });
    });

    it('should return a writable stream', () => {
      const transport = createPinoTransport({ telescope });

      expect(typeof transport.write).toBe('function');
      expect(typeof transport.end).toBe('function');
    });

    it('should batch logs and flush at batchSize', async () => {
      const transport = createPinoTransport({
        telescope,
        batchSize: 3,
        flushIntervalMs: 5000, // Long interval to test batch size trigger
      });
      const logger = pino({ level: 'debug' }, transport);

      // Write 2 logs - should not flush yet
      logger.info('Log 1');
      logger.info('Log 2');

      await new Promise((r) => setTimeout(r, 50));
      let logs = await telescope.getLogs();
      expect(logs).toHaveLength(0); // Not flushed yet

      // Write 3rd log - should trigger flush
      logger.info('Log 3');

      await new Promise((r) => setTimeout(r, 100));
      logs = await telescope.getLogs();
      expect(logs).toHaveLength(3);
    });

    it('should flush on close', async () => {
      const transport = createPinoTransport({
        telescope,
        batchSize: 100,
        flushIntervalMs: 10000, // Long interval
      });
      const logger = pino({ level: 'debug' }, transport);

      logger.info('Will be flushed on close');

      // End the stream to trigger close
      transport.end();

      await new Promise((r) => setTimeout(r, 100));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Will be flushed on close');
    });
  });

  describe('createPinoDestination', () => {
    it('should be an alias for createPinoTransport', () => {
      const transport = createPinoTransport({ telescope });
      const destination = createPinoDestination({ telescope });

      expect(typeof transport.write).toBe('function');
      expect(typeof destination.write).toBe('function');
    });

    it('should work the same as createPinoTransport', async () => {
      const destination = createPinoDestination({
        telescope,
        flushIntervalMs: 50,
      });
      const logger = pino({ level: 'debug' }, destination);

      logger.info('Destination test');

      await new Promise((r) => setTimeout(r, 100));

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Destination test');
    });
  });
});
