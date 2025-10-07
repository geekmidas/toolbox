import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDir,
  createMockEndpointFile,
  createMockFunctionFile,
  createMockCronFile,
  createTempDir,
  createTestFile,
} from '../../__tests__/test-helpers';
import { buildCommand } from '../index-new';

// Mock the config loader
vi.mock('../../config', () => ({
  loadConfig: vi.fn(),
}));

// Mock the manifest generator
vi.mock('../manifests', () => ({
  generateManifests: vi.fn(),
}));

// Mock the provider resolver
vi.mock('../providerResolver', () => ({
  resolveProviders: vi.fn(),
}));

describe('buildCommand', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupDir(tempDir);
  });

  it('should build endpoints, functions, and crons for multiple providers', async () => {
    // Setup mock config
    const mockConfig = {
      routes: './src/endpoints/**/*.ts',
      functions: './src/functions/**/*.ts',
      crons: './src/crons/**/*.ts',
      envParser: './config/env',
      logger: './config/logger',
    };

    const mockResolved = {
      providers: ['server', 'aws-lambda'],
      enableOpenApi: true,
    };

    const { loadConfig } = await import('../../config');
    const { resolveProviders } = await import('../providerResolver');
    const { generateManifests } = await import('../manifests');

    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(resolveProviders).mockReturnValue(mockResolved);
    vi.mocked(generateManifests).mockResolvedValue(undefined);

    // Create test files that will be discovered
    await createMockEndpointFile(tempDir, 'src/endpoints/users.ts', 'getUsersEndpoint', '/users', 'GET');
    await createMockEndpointFile(tempDir, 'src/endpoints/posts.ts', 'getPostsEndpoint', '/posts', 'GET');
    await createMockFunctionFile(tempDir, 'src/functions/process.ts', 'processDataFunction', 60);
    await createMockCronFile(tempDir, 'src/crons/cleanup.ts', 'cleanupCron', 'rate(1 day)');

    // Mock console.log to capture output
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await buildCommand({ provider: 'server' });

    // Verify config loading
    expect(loadConfig).toHaveBeenCalled();
    expect(resolveProviders).toHaveBeenCalledWith(mockConfig, { provider: 'server' });

    // Verify logging
    expect(logSpy).toHaveBeenCalledWith('Building with providers: server, aws-lambda');
    expect(logSpy).toHaveBeenCalledWith('Loading routes from: ./src/endpoints/**/*.ts');
    expect(logSpy).toHaveBeenCalledWith('Loading functions from: ./src/functions/**/*.ts');
    expect(logSpy).toHaveBeenCalledWith('Loading crons from: ./src/crons/**/*.ts');

    // Verify manifests were generated for each provider
    expect(generateManifests).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
  });

  it('should handle case with no constructs found', async () => {
    const mockConfig = {
      routes: './src/endpoints/**/*.ts',
      functions: './src/functions/**/*.ts',
      crons: './src/crons/**/*.ts',
      envParser: './config/env',
      logger: './config/logger',
    };

    const mockResolved = {
      providers: ['server'],
      enableOpenApi: false,
    };

    const { loadConfig } = await import('../../config');
    const { resolveProviders } = await import('../providerResolver');

    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(resolveProviders).mockReturnValue(mockResolved);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await buildCommand({ provider: 'server' });

    expect(logSpy).toHaveBeenCalledWith('Found 0 endpoints');
    expect(logSpy).toHaveBeenCalledWith('Found 0 functions');
    expect(logSpy).toHaveBeenCalledWith('Found 0 crons');
    expect(logSpy).toHaveBeenCalledWith('No endpoints, functions, or crons found to process');

    logSpy.mockRestore();
  });

  it('should handle optional functions and crons config', async () => {
    const mockConfig = {
      routes: './src/endpoints/**/*.ts',
      functions: undefined,
      crons: undefined,
      envParser: './config/env',
      logger: './config/logger',
    };

    const mockResolved = {
      providers: ['server'],
      enableOpenApi: false,
    };

    const { loadConfig } = await import('../../config');
    const { resolveProviders } = await import('../providerResolver');

    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(resolveProviders).mockReturnValue(mockResolved);

    await createMockEndpointFile(tempDir, 'src/endpoints/test.ts', 'testEndpoint', '/test', 'GET');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await buildCommand({ provider: 'server' });

    expect(logSpy).toHaveBeenCalledWith('Found 1 endpoints');
    expect(logSpy).toHaveBeenCalledWith('Found 0 functions');
    expect(logSpy).toHaveBeenCalledWith('Found 0 crons');

    // Should not log functions or crons loading messages
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Loading functions'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Loading crons'));

    logSpy.mockRestore();
  });

  it('should parse envParser configuration correctly', async () => {
    const mockConfig = {
      routes: './src/endpoints/**/*.ts',
      functions: undefined,
      crons: undefined,
      envParser: './config/env#customEnvParser',
      logger: './config/logger#customLogger',
    };

    const mockResolved = {
      providers: ['aws-apigatewayv2'],
      enableOpenApi: false,
    };

    const { loadConfig } = await import('../../config');
    const { resolveProviders } = await import('../providerResolver');
    const { generateManifests } = await import('../manifests');

    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(resolveProviders).mockReturnValue(mockResolved);
    vi.mocked(generateManifests).mockResolvedValue(undefined);

    await createMockEndpointFile(tempDir, 'src/endpoints/test.ts', 'testEndpoint', '/test', 'GET');

    await buildCommand({ provider: 'aws' });

    // Check that generateManifests was called with the correct build context
    expect(generateManifests).toHaveBeenCalledWith(
      'aws-apigatewayv2',
      expect.stringContaining('.gkm/aws-apigatewayv2'),
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
    );

    // Verify that a handler file was generated with correct imports
    const handlerFile = join(tempDir, '.gkm/aws-apigatewayv2/testEndpoint.ts');
    const handlerContent = await readFile(handlerFile, 'utf-8');
    expect(handlerContent).toContain('{ customEnvParser as envParser }');
  });

  it('should create output directories for each provider', async () => {
    const mockConfig = {
      routes: './src/endpoints/**/*.ts',
      functions: undefined,
      crons: undefined,
      envParser: './config/env',
      logger: './config/logger',
    };

    const mockResolved = {
      providers: ['server', 'aws-apigatewayv1', 'aws-apigatewayv2'],
      enableOpenApi: false,
    };

    const { loadConfig } = await import('../../config');
    const { resolveProviders } = await import('../providerResolver');
    const { generateManifests } = await import('../manifests');

    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(resolveProviders).mockReturnValue(mockResolved);
    vi.mocked(generateManifests).mockResolvedValue(undefined);

    await createMockEndpointFile(tempDir, 'src/endpoints/test.ts', 'testEndpoint', '/test', 'GET');

    await buildCommand({ provider: 'aws' });

    // Verify manifests were generated for each provider
    expect(generateManifests).toHaveBeenCalledTimes(3);
    expect(generateManifests).toHaveBeenCalledWith(
      'server',
      expect.stringContaining('.gkm/server'),
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
    );
    expect(generateManifests).toHaveBeenCalledWith(
      'aws-apigatewayv1',
      expect.stringContaining('.gkm/aws-apigatewayv1'),
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
    );
    expect(generateManifests).toHaveBeenCalledWith(
      'aws-apigatewayv2',
      expect.stringContaining('.gkm/aws-apigatewayv2'),
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
    );
  });

  it('should handle default import patterns for envParser and logger', async () => {
    const mockConfig = {
      routes: './src/endpoints/**/*.ts',
      functions: undefined,
      crons: undefined,
      envParser: './config/env',
      logger: './config/logger',
    };

    const mockResolved = {
      providers: ['aws-apigatewayv2'],
      enableOpenApi: false,
    };

    const { loadConfig } = await import('../../config');
    const { resolveProviders } = await import('../providerResolver');

    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(resolveProviders).mockReturnValue(mockResolved);

    await createMockEndpointFile(tempDir, 'src/endpoints/test.ts', 'testEndpoint', '/test', 'GET');

    await buildCommand({ provider: 'aws' });

    // Verify that a handler file was generated with default imports
    const handlerFile = join(tempDir, '.gkm/aws-apigatewayv2/testEndpoint.ts');
    const handlerContent = await readFile(handlerFile, 'utf-8');
    expect(handlerContent).toContain('import envParser');
    expect(handlerContent).not.toContain('{ envParser }');
  });

  it('should handle envParser pattern with same name as expected', async () => {
    const mockConfig = {
      routes: './src/endpoints/**/*.ts',
      functions: undefined,
      crons: undefined,
      envParser: './config/env#envParser',
      logger: './config/logger#logger',
    };

    const mockResolved = {
      providers: ['aws-apigatewayv2'],
      enableOpenApi: false,
    };

    const { loadConfig } = await import('../../config');
    const { resolveProviders } = await import('../providerResolver');

    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(resolveProviders).mockReturnValue(mockResolved);

    await createMockEndpointFile(tempDir, 'src/endpoints/test.ts', 'testEndpoint', '/test', 'GET');

    await buildCommand({ provider: 'aws' });

    // Verify that a handler file was generated with named imports
    const handlerFile = join(tempDir, '.gkm/aws-apigatewayv2/testEndpoint.ts');
    const handlerContent = await readFile(handlerFile, 'utf-8');
    expect(handlerContent).toContain('{ envParser }');
    expect(handlerContent).toContain('{ logger }');
  });
});