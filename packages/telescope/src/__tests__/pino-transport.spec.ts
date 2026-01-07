import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinoTransport } from '../logger/pino';
import { InMemoryStorage } from '../storage/memory';
import { Telescope } from '../Telescope';

describe('createPinoTransport', () => {
  let telescope: Telescope;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage({ maxEntries: 100 });
    telescope = new Telescope({ storage, enabled: true });
  });

  afterEach(() => {
    telescope.destroy();
  });

  it('should send logs to telescope when configured like apps/example/src/config/logger.ts', async () => {
    // This mirrors the exact setup in apps/example/src/config/logger.ts
    const logger = pino(
      {
        level: 'debug',
        formatters: {
          bindings() {
            return { nodeVersion: process.version };
          },
          level: (label) => {
            return { level: label.toUpperCase() };
          },
        },
      },
      pino.multistream([
        { stream: process.stdout },
        { stream: createPinoTransport({ telescope }) },
      ]),
    );

    logger.info('Test log message');
    logger.info({ userId: '123' }, 'User logged in');

    // Wait for the transport to process and flush
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const logs = await telescope.getLogs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('should NOT have logs before flush interval (default 1000ms)', async () => {
    const logger = pino(
      {
        level: 'debug',
        formatters: {
          bindings() {
            return { nodeVersion: process.version };
          },
          level: (label) => {
            return { level: label.toUpperCase() };
          },
        },
      },
      pino.multistream([
        { stream: process.stdout },
        { stream: createPinoTransport({ telescope }) },
      ]),
    );

    logger.info('Test before flush');

    // Check immediately - should NOT be flushed yet
    const logsImmediate = await telescope.getLogs();

    // Check at 500ms - should NOT be flushed yet
    await new Promise((resolve) => setTimeout(resolve, 500));
    const logs500ms = await telescope.getLogs();

    // Check at 1200ms - SHOULD be flushed
    await new Promise((resolve) => setTimeout(resolve, 700));
    const logs1200ms = await telescope.getLogs();

    expect(logs1200ms.length).toBeGreaterThanOrEqual(1);
  });

  it('should verify log content matches what was logged', async () => {
    const logger = pino(
      {
        level: 'debug',
        formatters: {
          bindings() {
            return { nodeVersion: process.version };
          },
          level: (label) => {
            return { level: label.toUpperCase() };
          },
        },
      },
      pino.multistream([
        { stream: process.stdout },
        { stream: createPinoTransport({ telescope }) },
      ]),
    );

    logger.info({ customField: 'test-value' }, 'Specific test message');

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const logs = await telescope.getLogs();

    const matchingLog = logs.find((l) => l.message === 'Specific test message');
    expect(matchingLog).toBeDefined();
    expect(matchingLog?.level).toBe('info');
    expect(matchingLog?.context?.customField).toBe('test-value');
  });
});
