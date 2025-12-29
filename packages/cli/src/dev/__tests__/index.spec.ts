import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { findAvailablePort, isPortAvailable, normalizeTelescopeConfig } from '../index';

/**
 * Helper to occupy a port for testing
 */
function occupyPort(port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', (err) => {
      reject(err);
    });

    server.once('listening', () => {
      resolve(server);
    });

    server.listen(port);
  });
}

describe('Port Availability Functions', () => {
  describe('isPortAvailable', () => {
    it('should return true for an available port', async () => {
      // Use a high port number to avoid conflicts
      const port = 45000;
      const available = await isPortAvailable(port);
      expect(available).toBe(true);
    });

    it('should return false for a port in use', async () => {
      const port = 45001;
      const server = await occupyPort(port);

      try {
        const available = await isPortAvailable(port);
        expect(available).toBe(false);
      } finally {
        server.close();
      }
    });

    it('should handle multiple sequential checks correctly', async () => {
      const port = 45002;

      // First check - port should be available
      const firstCheck = await isPortAvailable(port);
      expect(firstCheck).toBe(true);

      // Occupy the port
      const server = await occupyPort(port);

      try {
        // Second check - port should be unavailable
        const secondCheck = await isPortAvailable(port);
        expect(secondCheck).toBe(false);
      } finally {
        server.close();
      }

      // Give a moment for the port to be released
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Third check - port should be available again
      const thirdCheck = await isPortAvailable(port);
      expect(thirdCheck).toBe(true);
    });
  });

  describe('findAvailablePort', () => {
    it('should return the preferred port if available', async () => {
      const preferredPort = 45100;
      const foundPort = await findAvailablePort(preferredPort);
      expect(foundPort).toBe(preferredPort);
    });

    it('should return the next available port if preferred is in use', async () => {
      const preferredPort = 45101;
      const server = await occupyPort(preferredPort);

      try {
        const foundPort = await findAvailablePort(preferredPort);
        expect(foundPort).toBe(preferredPort + 1);
      } finally {
        server.close();
      }
    });

    it('should skip multiple occupied ports', async () => {
      const preferredPort = 45102;
      const server1 = await occupyPort(preferredPort);
      const server2 = await occupyPort(preferredPort + 1);
      const server3 = await occupyPort(preferredPort + 2);

      try {
        const foundPort = await findAvailablePort(preferredPort);
        expect(foundPort).toBe(preferredPort + 3);
      } finally {
        server1.close();
        server2.close();
        server3.close();
      }
    });

    it('should throw error if no available port found within max attempts', async () => {
      const preferredPort = 45103;
      const maxAttempts = 3;

      // Occupy ports 45103, 45104, 45105
      const servers = await Promise.all([
        occupyPort(preferredPort),
        occupyPort(preferredPort + 1),
        occupyPort(preferredPort + 2),
      ]);

      try {
        await expect(
          findAvailablePort(preferredPort, maxAttempts),
        ).rejects.toThrow(
          `Could not find an available port after trying ${maxAttempts} ports starting from ${preferredPort}`,
        );
      } finally {
        servers.forEach((server) => server.close());
      }
    });

    it('should respect custom maxAttempts parameter', async () => {
      const preferredPort = 45104;
      const maxAttempts = 5;

      // Occupy first 4 ports
      const servers = await Promise.all([
        occupyPort(preferredPort),
        occupyPort(preferredPort + 1),
        occupyPort(preferredPort + 2),
        occupyPort(preferredPort + 3),
      ]);

      try {
        const foundPort = await findAvailablePort(preferredPort, maxAttempts);
        // Should find port at preferredPort + 4 (within 5 attempts)
        expect(foundPort).toBe(preferredPort + 4);
      } finally {
        servers.forEach((server) => server.close());
      }
    });
  });
});

describe('DevServer', () => {
  describe('port selection', () => {
    it('should use requested port when available', async () => {
      // This is more of an integration test that would need the actual DevServer
      // For now, we test the underlying logic
      const requestedPort = 45200;
      const actualPort = await findAvailablePort(requestedPort);
      expect(actualPort).toBe(requestedPort);
    });

    it('should select alternative port when requested is in use', async () => {
      const requestedPort = 45201;
      const server = await occupyPort(requestedPort);

      try {
        const actualPort = await findAvailablePort(requestedPort);
        expect(actualPort).not.toBe(requestedPort);
        expect(actualPort).toBeGreaterThan(requestedPort);
        expect(actualPort).toBeLessThanOrEqual(requestedPort + 10);
      } finally {
        server.close();
      }
    });
  });
});

describe('devCommand edge cases', () => {
  it('should handle port conflicts gracefully', async () => {
    const port = 45300;
    const server = await occupyPort(port);

    try {
      // The dev command should find an alternative port
      const alternativePort = await findAvailablePort(port);
      expect(alternativePort).toBeGreaterThan(port);
    } finally {
      server.close();
    }
  });

  it('should handle concurrent port checks', async () => {
    const basePort = 45400;

    // Run multiple port checks concurrently
    const results = await Promise.all([
      findAvailablePort(basePort),
      findAvailablePort(basePort + 5),
      findAvailablePort(basePort + 10),
    ]);

    // All should succeed and return valid ports
    expect(results).toHaveLength(3);
    results.forEach((port) => {
      expect(port).toBeGreaterThanOrEqual(basePort);
    });
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
    });
  });
});
