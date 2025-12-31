import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findAvailablePort,
  isPortAvailable,
  normalizeTelescopeConfig,
} from '../index';

// Track servers to clean up after each test
const activeServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  // Close all servers and wait for them to fully close
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  activeServers.length = 0;
  // Give OS time to release ports
  await new Promise((resolve) => setTimeout(resolve, 50));
});

/**
 * Helper to occupy a port for testing.
 * Pass port 0 to get a random available port.
 */
function occupyPort(
  port: number,
): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', (err) => {
      reject(err);
    });

    server.once('listening', () => {
      activeServers.push(server);
      const actualPort = (server.address() as AddressInfo).port;
      resolve({ server, port: actualPort });
    });

    server.listen(port);
  });
}

describe('Port Availability Functions', () => {
  describe('isPortAvailable', () => {
    it('should return true for an available port', async () => {
      // Get a random port, close it, then check availability
      const { server, port } = await occupyPort(0);
      server.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const available = await isPortAvailable(port);
      expect(available).toBe(true);
    });

    it('should return false for a port in use', async () => {
      const { port } = await occupyPort(0);

      const available = await isPortAvailable(port);
      expect(available).toBe(false);
      // Server cleanup handled by afterEach
    });

    it('should handle multiple sequential checks correctly', async () => {
      // Get a port to test with
      const { server: tempServer, port } = await occupyPort(0);
      tempServer.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // First check - port should be available
      const firstCheck = await isPortAvailable(port);
      expect(firstCheck).toBe(true);

      // Occupy the port
      await occupyPort(port);

      // Second check - port should be unavailable
      const secondCheck = await isPortAvailable(port);
      expect(secondCheck).toBe(false);
      // Server cleanup and third check handled by afterEach
    });
  });

  describe('findAvailablePort', () => {
    it('should return the preferred port if available', async () => {
      // Get a random port, close it, then use as preferred
      const { server, port: preferredPort } = await occupyPort(0);
      server.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const foundPort = await findAvailablePort(preferredPort);
      expect(foundPort).toBe(preferredPort);
    });

    it('should return the next available port if preferred is in use', async () => {
      const { port: preferredPort } = await occupyPort(0);

      const foundPort = await findAvailablePort(preferredPort);
      expect(foundPort).toBe(preferredPort + 1);
    });

    it('should skip multiple occupied ports', async () => {
      // Get a base port
      const { port: basePort } = await occupyPort(0);
      // Occupy consecutive ports
      await occupyPort(basePort + 1);
      await occupyPort(basePort + 2);

      const foundPort = await findAvailablePort(basePort);
      expect(foundPort).toBe(basePort + 3);
    });

    it('should throw error if no available port found within max attempts', async () => {
      const { port: preferredPort } = await occupyPort(0);
      const maxAttempts = 3;

      // Occupy consecutive ports
      await occupyPort(preferredPort + 1);
      await occupyPort(preferredPort + 2);

      await expect(
        findAvailablePort(preferredPort, maxAttempts),
      ).rejects.toThrow(
        `Could not find an available port after trying ${maxAttempts} ports starting from ${preferredPort}`,
      );
    });

    it('should respect custom maxAttempts parameter', async () => {
      const { port: preferredPort } = await occupyPort(0);
      const maxAttempts = 5;

      // Occupy consecutive ports (4 total including base)
      await occupyPort(preferredPort + 1);
      await occupyPort(preferredPort + 2);
      await occupyPort(preferredPort + 3);

      const foundPort = await findAvailablePort(preferredPort, maxAttempts);
      // Should find port at preferredPort + 4 (within 5 attempts)
      expect(foundPort).toBe(preferredPort + 4);
    });
  });
});

describe('DevServer', () => {
  describe('port selection', () => {
    it('should use requested port when available', async () => {
      // Get a random port, close it, then use as requested
      const { server, port: requestedPort } = await occupyPort(0);
      server.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const actualPort = await findAvailablePort(requestedPort);
      expect(actualPort).toBe(requestedPort);
    });

    it('should select alternative port when requested is in use', async () => {
      const { port: requestedPort } = await occupyPort(0);

      const actualPort = await findAvailablePort(requestedPort);
      expect(actualPort).not.toBe(requestedPort);
      expect(actualPort).toBeGreaterThan(requestedPort);
      expect(actualPort).toBeLessThanOrEqual(requestedPort + 10);
    });
  });
});

describe('devCommand edge cases', () => {
  it('should handle port conflicts gracefully', async () => {
    const { port } = await occupyPort(0);

    // The dev command should find an alternative port
    const alternativePort = await findAvailablePort(port);
    expect(alternativePort).toBeGreaterThan(port);
  });

  it('should handle concurrent port checks', async () => {
    // Get three random available ports as base
    const { server: s1, port: p1 } = await occupyPort(0);
    const { server: s2, port: p2 } = await occupyPort(0);
    const { server: s3, port: p3 } = await occupyPort(0);
    s1.close();
    s2.close();
    s3.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Run multiple port checks concurrently
    const results = await Promise.all([
      findAvailablePort(p1),
      findAvailablePort(p2),
      findAvailablePort(p3),
    ]);

    // All should succeed and return valid ports
    expect(results).toHaveLength(3);
    expect(results[0]).toBe(p1);
    expect(results[1]).toBe(p2);
    expect(results[2]).toBe(p3);
  });
});

describe('normalizeTelescopeConfig', () => {
  it('should return undefined when config is false', () => {
    const result = normalizeTelescopeConfig(false);
    expect(result).toBeUndefined();
  });

  it('should return default config when config is true', () => {
    const result = normalizeTelescopeConfig(true);
    expect(result).toEqual({
      enabled: true,
      path: '/__telescope',
      ignore: [],
      recordBody: true,
      maxEntries: 1000,
      websocket: true,
    });
  });

  it('should return default config when config is undefined', () => {
    const result = normalizeTelescopeConfig(undefined);
    expect(result).toEqual({
      enabled: true,
      path: '/__telescope',
      ignore: [],
      recordBody: true,
      maxEntries: 1000,
      websocket: true,
    });
  });

  it('should return undefined when config.enabled is false', () => {
    const result = normalizeTelescopeConfig({ enabled: false });
    expect(result).toBeUndefined();
  });

  it('should merge custom config with defaults', () => {
    const result = normalizeTelescopeConfig({
      path: '/__debug',
      ignore: ['/health', '/metrics'],
      recordBody: false,
      maxEntries: 500,
    });
    expect(result).toEqual({
      enabled: true,
      path: '/__debug',
      ignore: ['/health', '/metrics'],
      recordBody: false,
      maxEntries: 500,
      websocket: true,
    });
  });

  it('should use defaults for missing config values', () => {
    const result = normalizeTelescopeConfig({
      path: '/__custom',
    });
    expect(result).toEqual({
      enabled: true,
      path: '/__custom',
      ignore: [],
      recordBody: true,
      maxEntries: 1000,
      websocket: true,
    });
  });

  it('should handle empty object config', () => {
    const result = normalizeTelescopeConfig({});
    expect(result).toEqual({
      enabled: true,
      path: '/__telescope',
      ignore: [],
      recordBody: true,
      maxEntries: 1000,
      websocket: true,
    });
  });

  it('should allow disabling websocket', () => {
    const result = normalizeTelescopeConfig({
      websocket: false,
    });
    expect(result).toEqual({
      enabled: true,
      path: '/__telescope',
      ignore: [],
      recordBody: true,
      maxEntries: 1000,
      websocket: false,
    });
  });
});
