import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openapiCommand } from '../openapi';
import {
  cleanupDir,
  createMockEndpointFile,
  createTempDir,
  createTestFile,
} from './test-helpers';

describe('OpenAPI Generation', () => {
  let tempDir: string;
  let configFile: string;

  beforeEach(async () => {
    tempDir = await createTempDir('openapi-test-');
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
    vi.restoreAllMocks();
  });

  describe('openapiCommand', () => {
    it('should generate OpenAPI spec for endpoints', async () => {
      // Create endpoint file
      await createMockEndpointFile(
        tempDir,
        'getUser.ts',
        'getUser',
        '/users/:id',
        'GET',
      );

      // Create config file
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');

      // Mock process.cwd
      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      await openapiCommand({ output: outputPath });

      // Verify file was created
      expect(existsSync(outputPath)).toBe(true);

      // Verify content
      const content = await readFile(outputPath, 'utf-8');
      const spec = JSON.parse(content);

      expect(spec).toHaveProperty('openapi');
      expect(spec).toHaveProperty('info');
      expect(spec.info.title).toBe('API Documentation');
      expect(spec).toHaveProperty('paths');
      expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    });

    it('should handle no endpoints found', async () => {
      // Create config with no matching files
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/nonexistent/**/*.ts`],
        }),
      );

      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
      const consoleSpy = vi.spyOn(console, 'log');

      await openapiCommand({ output: join(tempDir, 'openapi.json') });

      expect(consoleSpy).toHaveBeenCalledWith('No valid endpoints found');
    });

    it('should use default output path when not specified', async () => {
      // Create endpoint file
      await createMockEndpointFile(
        tempDir,
        'endpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create config
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      await openapiCommand();

      // Should create openapi.json in current directory
      expect(existsSync(join(tempDir, 'openapi.json'))).toBe(true);
    });

    it('should generate spec with multiple endpoints', async () => {
      // Create multiple endpoint files
      await createMockEndpointFile(
        tempDir,
        'getUsers.ts',
        'getUsers',
        '/users',
        'GET',
      );
      await createMockEndpointFile(
        tempDir,
        'createUser.ts',
        'createUser',
        '/users',
        'POST',
      );
      await createMockEndpointFile(
        tempDir,
        'deleteUser.ts',
        'deleteUser',
        '/users/:id',
        'DELETE',
      );

      // Create config
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');
      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      await openapiCommand({ output: outputPath });

      const content = await readFile(outputPath, 'utf-8');
      const spec = JSON.parse(content);

      // Should have multiple paths
      expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(1);
    });

    it('should create output directory if it does not exist', async () => {
      // Create endpoint file
      await createMockEndpointFile(
        tempDir,
        'endpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create config
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'nested', 'dir', 'openapi.json');
      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      await openapiCommand({ output: outputPath });

      expect(existsSync(outputPath)).toBe(true);
    });

    it('should include API metadata in spec', async () => {
      // Create endpoint
      await createMockEndpointFile(
        tempDir,
        'endpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create config
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');
      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      await openapiCommand({ output: outputPath });

      const content = await readFile(outputPath, 'utf-8');
      const spec = JSON.parse(content);

      expect(spec.info).toEqual({
        title: 'API Documentation',
        version: '1.0.0',
        description: 'Auto-generated API documentation from endpoints',
      });
    });

    it('should log generation success', async () => {
      // Create endpoint
      await createMockEndpointFile(
        tempDir,
        'endpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create config
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');
      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
      const consoleSpy = vi.spyOn(console, 'log');

      await openapiCommand({ output: outputPath });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('OpenAPI spec generated'),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found'),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('endpoints'),
      );
    });

    it('should throw error when config loading fails', async () => {
      // No config file created
      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      await expect(openapiCommand()).rejects.toThrow(/OpenAPI generation failed/);
    });

    it('should throw error for invalid TypeScript files', async () => {
      // Create invalid TS file
      await createTestFile(
        tempDir,
        'invalid.ts',
        'this is not valid typescript {[}]',
      );

      // Create config
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      // Should throw error for syntax errors
      await expect(
        openapiCommand({ output: join(tempDir, 'openapi.json') }),
      ).rejects.toThrow(/OpenAPI generation failed/);
    });

    it('should generate valid JSON format', async () => {
      // Create endpoint
      await createMockEndpointFile(
        tempDir,
        'endpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create config
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');
      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      await openapiCommand({ output: outputPath });

      const content = await readFile(outputPath, 'utf-8');

      // Should be valid JSON and properly formatted
      expect(() => JSON.parse(content)).not.toThrow();
      expect(content).toContain('\n'); // Formatted with indentation
    });

    it('should handle endpoints with complex schemas', async () => {
      // Create endpoint with complex schema
      const complexEndpointContent = `
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const complexEndpoint = e
  .post('/complex')
  .body(z.object({
    user: z.object({
      name: z.string(),
      email: z.string().email(),
      age: z.number().optional(),
    }),
    tags: z.array(z.string()),
  }))
  .output(z.object({
    id: z.string(),
    status: z.enum(['active', 'inactive']),
  }))
  .handle(async () => ({ id: '123', status: 'active' as const }));
`;

      await createTestFile(tempDir, 'complex.ts', complexEndpointContent);

      // Create config
      configFile = await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');
      vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

      await openapiCommand({ output: outputPath });

      const content = await readFile(outputPath, 'utf-8');
      const spec = JSON.parse(content);

      // Should have generated schema for complex types
      expect(spec.paths).toBeDefined();
    });
  });
});
