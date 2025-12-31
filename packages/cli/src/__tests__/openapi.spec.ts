import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateOpenApi,
  openapiCommand,
  resolveOpenApiConfig,
} from '../openapi';
import type { GkmConfig } from '../types';
import {
  cleanupDir,
  createMockEndpointFile,
  createTempDir,
  createTestFile,
} from './test-helpers';

describe('resolveOpenApiConfig', () => {
  const baseConfig: GkmConfig = {
    routes: './src/endpoints/**/*.ts',
    envParser: './src/config/env#envParser',
    logger: './src/config/logger#logger',
  };

  it('should return disabled when openapi is false', () => {
    const result = resolveOpenApiConfig({ ...baseConfig, openapi: false });
    expect(result).toEqual({ enabled: false });
  });

  it('should return enabled with defaults when openapi is true', () => {
    const result = resolveOpenApiConfig({ ...baseConfig, openapi: true });
    expect(result).toEqual({
      enabled: true,
      output: './src/api/openapi.ts',
      json: false,
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Auto-generated API documentation from endpoints',
    });
  });

  it('should return disabled when openapi is undefined', () => {
    const result = resolveOpenApiConfig({ ...baseConfig });
    expect(result.enabled).toBe(false);
  });

  it('should use custom config values when provided', () => {
    const result = resolveOpenApiConfig({
      ...baseConfig,
      openapi: {
        enabled: true,
        output: './custom/path.ts',
        json: true,
        title: 'My API',
        version: '2.0.0',
        description: 'Custom description',
      },
    });
    expect(result).toEqual({
      enabled: true,
      output: './custom/path.ts',
      json: true,
      title: 'My API',
      version: '2.0.0',
      description: 'Custom description',
    });
  });

  it('should use defaults for missing optional config values', () => {
    const result = resolveOpenApiConfig({
      ...baseConfig,
      openapi: { enabled: true },
    });
    expect(result).toEqual({
      enabled: true,
      output: './src/api/openapi.ts',
      json: false,
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Auto-generated API documentation from endpoints',
    });
  });

  it('should be enabled by default when object provided without enabled field', () => {
    const result = resolveOpenApiConfig({
      ...baseConfig,
      openapi: { output: './custom.ts' },
    });
    expect(result.enabled).toBe(true);
  });
});

describe('generateOpenApi', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('openapi-gen-');
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
    vi.restoreAllMocks();
  });

  it('should return null when openapi is disabled', async () => {
    const config: GkmConfig = {
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
      openapi: false,
    };

    const result = await generateOpenApi(config);
    expect(result).toBeNull();
  });

  it('should return null when openapi is undefined', async () => {
    const config: GkmConfig = {
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    };

    const result = await generateOpenApi(config);
    expect(result).toBeNull();
  });

  it('should generate and return endpoint count', async () => {
    await createMockEndpointFile(tempDir, 'test.ts', 'test', '/test', 'GET');

    const outputPath = join(tempDir, 'openapi.json');
    const config: GkmConfig = {
      routes: `${tempDir}/**/*.ts`,
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
      openapi: {
        enabled: true,
        output: outputPath,
        json: true,
      },
    };

    const result = await generateOpenApi(config, { silent: true });

    expect(result).not.toBeNull();
    expect(result?.endpointCount).toBe(1);
    expect(result?.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);
  });

  it('should generate with absolute output path', async () => {
    await createMockEndpointFile(tempDir, 'test.ts', 'test', '/test', 'GET');

    const absolutePath = join(tempDir, 'absolute-openapi.json');
    const config: GkmConfig = {
      routes: `${tempDir}/**/*.ts`,
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
      openapi: {
        enabled: true,
        output: absolutePath,
        json: true,
      },
    };

    const result = await generateOpenApi(config, { silent: true });

    expect(result).not.toBeNull();
    expect(result?.outputPath).toBe(absolutePath);
    expect(existsSync(absolutePath)).toBe(true);
  });
});

describe('OpenAPI Generation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('openapi-test-');
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
    vi.restoreAllMocks();
  });

  describe('openapiCommand - TypeScript output (default)', () => {
    it('should generate TypeScript module by default', async () => {
      await createMockEndpointFile(
        tempDir,
        'getUser.ts',
        'getUser',
        '/users/:id',
        'GET',
      );

      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.ts');

      await openapiCommand({ output: outputPath, cwd: tempDir });

      expect(existsSync(outputPath)).toBe(true);

      const content = await readFile(outputPath, 'utf-8');

      expect(content).toContain('// Auto-generated by @geekmidas/cli');
      expect(content).toContain('export const securitySchemes');
      expect(content).toContain('export const endpointAuth');
      expect(content).toContain('export interface paths');
    });

    it('should include endpoint auth map', async () => {
      await createMockEndpointFile(
        tempDir,
        'getUser.ts',
        'getUser',
        '/users/:id',
        'GET',
      );

      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.ts');

      await openapiCommand({ output: outputPath, cwd: tempDir });

      const content = await readFile(outputPath, 'utf-8');

      expect(content).toContain('endpointAuth');
      expect(content).toContain("'GET /users/{id}'");
    });
  });

  describe('openapiCommand - JSON output (legacy)', () => {
    it('should generate JSON OpenAPI spec with --json flag', async () => {
      await createMockEndpointFile(
        tempDir,
        'getUser.ts',
        'getUser',
        '/users/:id',
        'GET',
      );

      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');

      await openapiCommand({ output: outputPath, json: true, cwd: tempDir });

      expect(existsSync(outputPath)).toBe(true);

      const content = await readFile(outputPath, 'utf-8');
      const spec = JSON.parse(content);

      expect(spec).toHaveProperty('openapi');
      expect(spec).toHaveProperty('info');
      expect(spec.info.title).toBe('API Documentation');
      expect(spec).toHaveProperty('paths');
      expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    });

    it('should handle no endpoints found', async () => {
      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/nonexistent/**/*.ts`],
        }),
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await openapiCommand({
        output: join(tempDir, 'openapi.json'),
        json: true,
        cwd: tempDir,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'No valid endpoints found for OpenAPI generation',
      );
    });

    it('should generate spec with multiple endpoints', async () => {
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

      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');

      await openapiCommand({ output: outputPath, json: true, cwd: tempDir });

      const content = await readFile(outputPath, 'utf-8');
      const spec = JSON.parse(content);

      expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(1);
    });

    it('should create output directory if it does not exist', async () => {
      await createMockEndpointFile(
        tempDir,
        'endpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'nested', 'dir', 'openapi.json');

      await openapiCommand({ output: outputPath, json: true, cwd: tempDir });

      expect(existsSync(outputPath)).toBe(true);
    });

    it('should include API metadata in spec', async () => {
      await createMockEndpointFile(
        tempDir,
        'endpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');

      await openapiCommand({ output: outputPath, json: true, cwd: tempDir });

      const content = await readFile(outputPath, 'utf-8');
      const spec = JSON.parse(content);

      expect(spec.info).toEqual({
        title: 'API Documentation',
        version: '1.0.0',
        description: 'Auto-generated API documentation from endpoints',
      });
    });

    it('should log generation success for JSON', async () => {
      // Create endpoint
      await createMockEndpointFile(
        tempDir,
        'endpoint.ts',
        'testEndpoint',
        '/test',
        'GET',
      );

      // Create config
      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');
      const consoleSpy = vi.spyOn(console, 'log');

      await openapiCommand({ output: outputPath, json: true, cwd: tempDir });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('OpenAPI JSON generated'),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 endpoints'),
      );
    });

    it('should throw error when config loading fails', async () => {
      // No config file created
      await expect(
        openapiCommand({ json: true, cwd: tempDir }),
      ).rejects.toThrow(/OpenAPI generation failed/);
    });

    it('should throw error for invalid TypeScript files', async () => {
      // Create invalid TS file
      await createTestFile(
        tempDir,
        'invalid.ts',
        'this is not valid typescript {[}]',
      );

      // Create config
      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      // Should throw error for syntax errors
      await expect(
        openapiCommand({
          output: join(tempDir, 'openapi.json'),
          json: true,
          cwd: tempDir,
        }),
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
      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');

      await openapiCommand({ output: outputPath, json: true, cwd: tempDir });

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
      await createTestFile(
        tempDir,
        'gkm.config.json',
        JSON.stringify({
          routes: [`${tempDir}/**/*.ts`],
        }),
      );

      const outputPath = join(tempDir, 'openapi.json');

      await openapiCommand({ output: outputPath, json: true, cwd: tempDir });

      const content = await readFile(outputPath, 'utf-8');
      const spec = JSON.parse(content);

      // Should have generated schema for complex types
      expect(spec.paths).toBeDefined();
    });
  });
});
