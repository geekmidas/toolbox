import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GkmConfig } from '../types';
import {
	cleanupDir,
	createMockEndpointFile,
	createSurfaceFile,
	createTempDir,
	createTestFile,
} from './test-helpers';

const spawnCalls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
let mockSpawnExitCode = 0;

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return {
		...actual,
		spawn: vi.fn((cmd: string, args: string[], opts: any) => {
			spawnCalls.push({ cmd, args: args ?? [], cwd: opts?.cwd ?? '' });
			const child: any = {
				on(event: string, cb: (code?: number) => void) {
					if (event === 'close') queueMicrotask(() => cb(mockSpawnExitCode));
					return child;
				},
			};
			return child;
		}),
	};
});

const {
	generateOpenApiFrom,
	openApiPathFor,
	openapiCommand,
	resolveOpenApiConfig,
} = await import('../openapi');

describe('resolveOpenApiConfig', () => {
	const baseConfig: GkmConfig = {
		constructs: './src/endpoints/**/*.ts',
	};

	it('should return disabled when openapi is false', () => {
		const result = resolveOpenApiConfig({ ...baseConfig, openapi: false });
		expect(result).toEqual({ enabled: false });
	});

	it('should return enabled with defaults when openapi is true', () => {
		const result = resolveOpenApiConfig({ ...baseConfig, openapi: true });
		expect(result).toEqual({
			enabled: true,
			title: 'API Documentation',
			version: '1.0.0',
			description: 'Auto-generated API documentation from endpoints',
		});
	});

	it('should return enabled by default when openapi is undefined', () => {
		const result = resolveOpenApiConfig({ ...baseConfig });
		expect(result.enabled).toBe(true);
	});

	it('should use custom config values when provided', () => {
		const result = resolveOpenApiConfig({
			...baseConfig,
			openapi: {
				enabled: true,
				title: 'My API',
				version: '2.0.0',
				description: 'Custom description',
			},
		});
		expect(result).toEqual({
			enabled: true,
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
			title: 'API Documentation',
			version: '1.0.0',
			description: 'Auto-generated API documentation from endpoints',
		});
	});

	it('should be enabled by default when object provided without enabled field', () => {
		const result = resolveOpenApiConfig({
			...baseConfig,
			openapi: { title: 'Custom Title' },
		});
		expect(result.enabled).toBe(true);
	});
});

describe('generateOpenApi', () => {
	let tempDir: string;
	const originalCwd = process.cwd();

	beforeEach(async () => {
		tempDir = realpathSync(await createTempDir('openapi-gen-'));
		// Change to temp dir so output goes there
		process.chdir(tempDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await cleanupDir(tempDir);
		vi.restoreAllMocks();
	});

	it('should return null when openapi is disabled', async () => {
		const routes = './src/endpoints/**/*.ts';
		const openapi = false;

		const result = await generateOpenApiFrom(routes, { openapi });
		expect(result).toBeNull();
	});

	it('should return null when no endpoints are found', async () => {
		// Path doesn't exist.
		const result = await generateOpenApiFrom('./src/endpoints/**/*.ts', {
			openapi: { enabled: true },
		});
		expect(result).toBeNull();
	});

	it('names the spec after the surface that serves it', async () => {
		await createMockEndpointFile(tempDir, 'test.ts', 'test', '/test', 'GET');

		const routes = `${tempDir}/**/*.ts`;
		const openapi = { enabled: true };

		const result = await generateOpenApiFrom(routes, { openapi, silent: true });

		expect(result).not.toBeNull();
		expect(result?.endpointCount).toBe(1);
		expect(result?.outputPath).toBe(join(tempDir, openApiPathFor('Test')));
		expect(existsSync(join(tempDir, openApiPathFor('Test')))).toBe(true);
	});

	it('cuts one spec per surface, not one per directory', async () => {
		// The case this replaces: two surfaces whose endpoints sit side by side
		// produced a single spec describing both, under a filename that named
		// neither. The directory is not the surface.
		const twoSurfaces = `
import { z } from 'zod';
import { RestApi } from '@geekmidas/constructs/rest-api';

const api = new RestApi('Api', { defaultAuthorizer: 'none' });
const webhooks = new RestApi('Webhooks', { defaultAuthorizer: 'none' });

export const listUsers = api
  .get('/users')
  .output(z.object({ ok: z.boolean() }))
  .handle(async () => ({ ok: true }));

export const receive = webhooks
  .post('/hooks/stripe')
  .output(z.object({ ok: z.boolean() }))
  .handle(async () => ({ ok: true }));
`;
		await createTestFile(tempDir, 'both.ts', twoSurfaces);

		const routes = `${tempDir}/**/*.ts`;
		const openapi = { enabled: true };

		const result = await generateOpenApiFrom(routes, { openapi, silent: true });

		expect(result?.endpointCount).toBe(2);
		expect(result?.outputPaths).toHaveLength(2);
		expect(existsSync(join(tempDir, openApiPathFor('Api')))).toBe(true);
		expect(existsSync(join(tempDir, openApiPathFor('Webhooks')))).toBe(true);

		// And each one describes only its own routes.
		const api = await readFile(join(tempDir, openApiPathFor('Api')), 'utf-8');
		const hooks = await readFile(
			join(tempDir, openApiPathFor('Webhooks')),
			'utf-8',
		);

		expect(api).toContain('/users');
		expect(api).not.toContain('/hooks/stripe');
		expect(hooks).toContain('/hooks/stripe');
		expect(hooks).not.toContain('/users');
	});

	it('kebab-cases a multi-word surface, as every physical name is', async () => {
		const content = `
import { z } from 'zod';
import { RestApi } from '@geekmidas/constructs/rest-api';

const adminApi = new RestApi('AdminApi', { defaultAuthorizer: 'none' });

export const listAll = adminApi
  .get('/admin/users')
  .output(z.object({ ok: z.boolean() }))
  .handle(async () => ({ ok: true }));
`;
		await createTestFile(tempDir, 'admin.ts', content);

		const result = await generateOpenApiFrom(`${tempDir}/**/*.ts`, {
			openapi: { enabled: true },
			silent: true,
		});

		expect(result?.outputPaths).toEqual([
			join(tempDir, './.gkm/openapi/admin-api.ts'),
		]);
	});

	it('should generate TypeScript content', async () => {
		await createMockEndpointFile(tempDir, 'test.ts', 'test', '/test', 'GET');

		const routes = `${tempDir}/**/*.ts`;
		const openapi = { enabled: true };

		await generateOpenApiFrom(routes, { openapi, silent: true });

		const content = await readFile(
			join(tempDir, openApiPathFor('Test')),
			'utf-8',
		);
		expect(content).toContain('// Auto-generated by @geekmidas/cli');
		expect(content).toContain('export const securitySchemes');
		expect(content).toContain('export interface paths');
	});

	it('should log no endpoints message when none found', async () => {
		const routes = `${tempDir}/nonexistent/**/*.ts`;
		const openapi = { enabled: true };

		const consoleSpy = vi.spyOn(console, 'log');
		const result = await generateOpenApiFrom(routes, { openapi });

		expect(result).toBeNull();
		expect(consoleSpy).toHaveBeenCalledWith(
			'No valid endpoints found for OpenAPI generation',
		);
	});
});

describe('openapiCommand', () => {
	let tempDir: string;
	const originalCwd = process.cwd();

	beforeEach(async () => {
		tempDir = realpathSync(await createTempDir('openapi-cmd-'));
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		// Clean up any generated .gkm folder in current directory
		await rm(join(originalCwd, '.gkm'), { recursive: true, force: true });
		await cleanupDir(tempDir);
		vi.restoreAllMocks();
	});

	it('should generate an OpenAPI client per surface', async () => {
		await createMockEndpointFile(
			tempDir,
			'test.ts',
			'testEndpoint',
			'/test',
			'GET',
		);

		await createTestFile(
			tempDir,
			'gkm.config.json',
			JSON.stringify({
				constructs: [`${tempDir}/**/*.ts`],
				openapi: { enabled: true },
			}),
		);

		// Change to temp dir so output goes there
		process.chdir(tempDir);

		await openapiCommand({ cwd: tempDir });

		const outputPath = join(tempDir, openApiPathFor('Test'));
		expect(existsSync(outputPath)).toBe(true);

		const content = await readFile(outputPath, 'utf-8');
		expect(content).toContain('// Auto-generated by @geekmidas/cli');
	});

	it('should enable openapi with defaults when not configured', async () => {
		await createMockEndpointFile(
			tempDir,
			'test.ts',
			'testEndpoint',
			'/test',
			'GET',
		);

		await createTestFile(
			tempDir,
			'gkm.config.json',
			JSON.stringify({
				constructs: [`${tempDir}/**/*.ts`],
			}),
		);

		process.chdir(tempDir);
		const consoleSpy = vi.spyOn(console, 'log');

		await openapiCommand({ cwd: tempDir });

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Found 1 endpoints'),
		);
		expect(existsSync(join(tempDir, openApiPathFor('Test')))).toBe(true);
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
				constructs: [`${tempDir}/**/*.ts`],
				openapi: { enabled: true },
			}),
		);

		process.chdir(tempDir);

		await openapiCommand({ cwd: tempDir });

		const content = await readFile(
			join(tempDir, openApiPathFor('Test')),
			'utf-8',
		);
		expect(content).toContain('endpointAuth');
		expect(content).toContain("'GET /users/{id}'");
	});

	it('should handle no endpoints found', async () => {
		await createTestFile(
			tempDir,
			'gkm.config.json',
			JSON.stringify({
				constructs: [`${tempDir}/nonexistent/**/*.ts`],
				openapi: { enabled: true },
			}),
		);

		process.chdir(tempDir);
		const consoleSpy = vi.spyOn(console, 'log');

		await openapiCommand({ cwd: tempDir });

		// A glob matching nothing declares no surface, and a surface is what an
		// app is derived from — so there is no app to generate for, which is a
		// different thing from an app with no endpoints and says so.
		expect(consoleSpy).toHaveBeenCalledWith(
			'No backend apps with OpenAPI enabled found',
		);
	});

	it('should generate with multiple endpoints', async () => {
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
				constructs: [`${tempDir}/**/*.ts`],
				openapi: { enabled: true },
			}),
		);

		process.chdir(tempDir);
		const consoleSpy = vi.spyOn(console, 'log');

		await openapiCommand({ cwd: tempDir });

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Found 3 endpoints'),
		);
	});

	it('should create .gkm directory if it does not exist', async () => {
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
				constructs: [`${tempDir}/**/*.ts`],
				openapi: { enabled: true },
			}),
		);

		process.chdir(tempDir);

		await openapiCommand({ cwd: tempDir });

		expect(existsSync(join(tempDir, '.gkm'))).toBe(true);
		expect(existsSync(join(tempDir, openApiPathFor('Test')))).toBe(true);
	});

	it('should throw error when config loading fails', async () => {
		process.chdir(tempDir);

		// No config file at all, which is not something to carry on from.
		await expect(openapiCommand({ cwd: tempDir })).rejects.toThrow(
			/OpenAPI generation failed/,
		);
	});

	it('should throw error for invalid TypeScript files', async () => {
		await createTestFile(
			tempDir,
			'invalid.ts',
			'this is not valid typescript {[}]',
		);

		await createTestFile(
			tempDir,
			'gkm.config.json',
			JSON.stringify({
				constructs: [`${tempDir}/**/*.ts`],
				openapi: { enabled: true },
			}),
		);

		process.chdir(tempDir);
		const warnSpy = vi.spyOn(console, 'warn');

		await openapiCommand({ cwd: tempDir });

		// A file that does not parse takes discovery down with it, and the
		// workspace falls back to what config alone declares — which is nothing
		// here. It warns rather than throwing, deliberately: one unreadable
		// construct should not stop a command that can still do part of its job.
		// It must not pass in silence, which is what this pins.
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('Could not read constructs'),
		);
	});

	it('should log generation success', async () => {
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
				constructs: [`${tempDir}/**/*.ts`],
				openapi: { enabled: true },
			}),
		);

		process.chdir(tempDir);
		const consoleSpy = vi.spyOn(console, 'log');

		await openapiCommand({ cwd: tempDir });

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('OpenAPI client generated'),
		);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Found 1 endpoints'),
		);
	});

	it('should handle endpoints with complex schemas', async () => {
		// The surface is shared and exported, because discovery has to *find* one
		// to derive an app — a `const api` local to this file is invisible to it.
		await createSurfaceFile(tempDir);

		const complexEndpointContent = `
import { z } from 'zod';
import { api } from './src/constructs/api.js';

export const complexEndpoint = api
  .post('/complex')
  .body(z.object({
    user: z.object({
      name: z.string(),
      email: z.email(),
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

		await createTestFile(
			tempDir,
			'gkm.config.json',
			JSON.stringify({
				constructs: [`${tempDir}/**/*.ts`],
				openapi: { enabled: true },
			}),
		);

		process.chdir(tempDir);

		await openapiCommand({ cwd: tempDir });

		const content = await readFile(
			join(tempDir, openApiPathFor('Test')),
			'utf-8',
		);
		expect(content).toContain('export interface paths');
	});
});

describe('openapiCommand - workspace mode', () => {
	let tempDir: string;
	const originalCwd = process.cwd();

	beforeEach(async () => {
		tempDir = realpathSync(await createTempDir('openapi-workspace-'));
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await cleanupDir(tempDir);
		vi.restoreAllMocks();
	});

	it('should generate OpenAPI for a single app via --app flag', async () => {
		// Create workspace structure
		const apiDir = join(tempDir, 'apps/api');
		await mkdir(apiDir, { recursive: true });

		// Create endpoint in backend app
		await createMockEndpointFile(
			apiDir,
			'src/endpoints/users.ts',
			'getUsers',
			'/users',
			'GET',
		);

		// Create workspace config (gkm.config.json)
		await createTestFile(
			tempDir,
			'gkm.config.json',
			JSON.stringify({
				name: 'test-workspace',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						constructs: './src/endpoints/**/*.ts',
						openapi: { enabled: true },
					},
				},
			}),
		);

		// Subprocess invocation simulated: CWD = appPath, --app passed
		process.chdir(apiDir);
		const consoleSpy = vi.spyOn(console, 'log');

		await openapiCommand({ cwd: tempDir, app: 'api' });

		// Should generate OpenAPI in the backend app's .gkm folder
		const outputPath = join(apiDir, openApiPathFor('Test'));
		expect(existsSync(outputPath)).toBe(true);

		const content = await readFile(outputPath, 'utf-8');
		expect(content).toContain('export interface paths');
		expect(content).toContain("'/users'");

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('[api] Generated OpenAPI'),
		);
	});

	it('should throw when --app references unknown app', async () => {
		await createTestFile(
			tempDir,
			'gkm.config.json',
			JSON.stringify({
				name: 'test-workspace',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						constructs: './src/endpoints/**/*.ts',
						openapi: { enabled: true },
					},
				},
			}),
		);

		await expect(
			openapiCommand({ cwd: tempDir, app: 'missing' }),
		).rejects.toThrow(/App "missing" not found/);
	});

	it('should spawn one subprocess per backend app in multi-app mode', async () => {
		// Create workspace with two backend apps
		const apiDir = join(tempDir, 'apps/api');
		const adminDir = join(tempDir, 'apps/admin');
		await mkdir(apiDir, { recursive: true });
		await mkdir(adminDir, { recursive: true });

		await createTestFile(
			tempDir,
			'gkm.config.json',
			JSON.stringify({
				name: 'test-workspace',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						constructs: './src/endpoints/**/*.ts',
						openapi: { enabled: true },
					},
					admin: {
						type: 'backend',
						path: 'apps/admin',
						port: 3001,
						constructs: './src/endpoints/**/*.ts',
						openapi: { enabled: true },
					},
				},
			}),
		);

		spawnCalls.length = 0;
		mockSpawnExitCode = 0;

		await openapiCommand({ cwd: tempDir });

		expect(spawnCalls).toHaveLength(2);
		expect(spawnCalls[0]?.cwd).toBe(apiDir);
		expect(spawnCalls[0]?.args).toContain('--app');
		expect(spawnCalls[0]?.args).toContain('api');
		expect(spawnCalls[1]?.cwd).toBe(adminDir);
		expect(spawnCalls[1]?.args).toContain('--app');
		expect(spawnCalls[1]?.args).toContain('admin');
	});
});
