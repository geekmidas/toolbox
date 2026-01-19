import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	copyAllClients,
	copyClientToFrontends,
	getBackendDependencies,
	getBackendOpenApiPath,
	getDependentFrontends,
	getFirstRoute,
	normalizeRoutes,
	shouldRegenerateClient,
} from '../client-generator.js';
import type { NormalizedWorkspace } from '../types.js';

describe('Client Generator', () => {
	describe('normalizeRoutes', () => {
		it('should return empty array for undefined', () => {
			expect(normalizeRoutes(undefined)).toEqual([]);
		});

		it('should return array as-is', () => {
			expect(normalizeRoutes(['./src/**/*.ts', './api/**/*.ts'])).toEqual([
				'./src/**/*.ts',
				'./api/**/*.ts',
			]);
		});

		it('should wrap string in array', () => {
			expect(normalizeRoutes('./src/**/*.ts')).toEqual(['./src/**/*.ts']);
		});
	});

	describe('getFirstRoute', () => {
		it('should return null for undefined', () => {
			expect(getFirstRoute(undefined)).toBeNull();
		});

		it('should return first element of array', () => {
			expect(getFirstRoute(['./src/**/*.ts', './api/**/*.ts'])).toBe(
				'./src/**/*.ts',
			);
		});

		it('should return string directly', () => {
			expect(getFirstRoute('./src/**/*.ts')).toBe('./src/**/*.ts');
		});

		it('should return null for empty array', () => {
			expect(getFirstRoute([])).toBeNull();
		});
	});

	describe('shouldRegenerateClient', () => {
		it('should return true for TypeScript files in routes directory', () => {
			expect(
				shouldRegenerateClient(
					'apps/api/src/endpoints/users.ts',
					'./src/endpoints/**/*.ts',
				),
			).toBe(true);
		});

		it('should return false for non-TypeScript files', () => {
			expect(
				shouldRegenerateClient(
					'apps/api/src/endpoints/README.md',
					'./src/endpoints/**/*.ts',
				),
			).toBe(false);
		});

		it('should return false for files outside routes pattern', () => {
			expect(
				shouldRegenerateClient(
					'apps/api/src/utils/helpers.ts',
					'./src/endpoints/**/*.ts',
				),
			).toBe(false);
		});

		it('should return true for .tsx files', () => {
			expect(
				shouldRegenerateClient(
					'apps/api/src/endpoints/users.tsx',
					'./src/endpoints/**/*.ts',
				),
			).toBe(true);
		});
	});

	describe('getBackendDependencies', () => {
		it('should return backend dependencies with routes', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3001,
						dependencies: [],
						routes: './src/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api', 'auth'],
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const deps = getBackendDependencies(workspace, 'web');
			expect(deps).toEqual(['api', 'auth']);
		});

		it('should filter out backends without routes', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					worker: {
						type: 'backend',
						path: 'apps/worker',
						port: 3001,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
						// No routes - not an HTTP backend
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api', 'worker'],
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const deps = getBackendDependencies(workspace, 'web');
			expect(deps).toEqual(['api']);
		});

		it('should return empty array for non-frontend app', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const deps = getBackendDependencies(workspace, 'api');
			expect(deps).toEqual([]);
		});
	});

	describe('getDependentFrontends', () => {
		it('should find frontends that depend on a backend', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: ['api'],
						resolvedDeployTarget: 'dokploy',
					},
					admin: {
						type: 'frontend',
						path: 'apps/admin',
						port: 3002,
						dependencies: ['api'],
						resolvedDeployTarget: 'dokploy',
					},
					docs: {
						type: 'frontend',
						path: 'apps/docs',
						port: 3003,
						dependencies: [], // No API dependency
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const dependents = getDependentFrontends(workspace, 'api');
			expect(dependents).toEqual(['web', 'admin']);
		});

		it('should return empty array for backend with no dependents', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const dependents = getDependentFrontends(workspace, 'api');
			expect(dependents).toEqual([]);
		});
	});

	describe('getBackendOpenApiPath', () => {
		it('should return correct path for backend app', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/project',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const path = getBackendOpenApiPath(workspace, 'api');
			expect(path).toBe('/project/apps/api/.gkm/openapi.ts');
		});

		it('should return null for non-backend app', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/project',
				apps: {
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3000,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const path = getBackendOpenApiPath(workspace, 'web');
			expect(path).toBeNull();
		});

		it('should return null for non-existent app', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/project',
				apps: {},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const path = getBackendOpenApiPath(workspace, 'nonexistent');
			expect(path).toBeNull();
		});
	});

	describe('copyClientToFrontends', () => {
		let testDir: string;

		beforeEach(() => {
			testDir = join(
				tmpdir(),
				`gkm-client-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		function createOpenApiFile(
			appDir: string,
			endpoints: Array<{ method: string; path: string }>,
		): void {
			const endpointAuthEntries = endpoints
				.map((ep) => `  '${ep.method.toUpperCase()} ${ep.path}': null,`)
				.join('\n');

			const content = `// Auto-generated by @geekmidas/cli - DO NOT EDIT

export const endpointAuth = {
${endpointAuthEntries}
} as const;

export const paths = {};
export function createApi() { return {}; }
`;

			const gkmDir = join(appDir, '.gkm');
			mkdirSync(gkmDir, { recursive: true });
			writeFileSync(join(gkmDir, 'openapi.ts'), content);
		}

		it('should copy client to dependent frontends', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createOpenApiFile(apiDir, [
				{ method: 'GET', path: '/users' },
				{ method: 'POST', path: '/users' },
			]);

			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: ['api'],
						client: { output: 'src/api' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await copyClientToFrontends(workspace, 'api', {
				silent: true,
			});

			expect(results).toHaveLength(1);
			expect(results[0]?.success).toBe(true);
			expect(results[0]?.frontendApp).toBe('web');
			expect(results[0]?.backendApp).toBe('api');
			expect(results[0]?.endpointCount).toBe(2);
			expect(existsSync(join(webDir, 'src/api/api.ts'))).toBe(true);
		});

		it('should skip frontends without client.output configured', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createOpenApiFile(apiDir, [{ method: 'GET', path: '/users' }]);

			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: ['api'],
						// No client.output configured
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await copyClientToFrontends(workspace, 'api', {
				silent: true,
			});

			expect(results).toHaveLength(0);
		});

		it('should return empty results for non-backend app', async () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await copyClientToFrontends(workspace, 'web', {
				silent: true,
			});

			expect(results).toEqual([]);
		});

		it('should return empty results when openapi file does not exist', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(apiDir, { recursive: true });
			mkdirSync(webDir, { recursive: true });
			// Don't create openapi file

			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: ['api'],
						client: { output: 'src/api' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await copyClientToFrontends(workspace, 'api', {
				silent: true,
			});

			expect(results).toEqual([]);
		});

		it('should copy to multiple frontends', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			const adminDir = join(testDir, 'apps/admin');
			mkdirSync(webDir, { recursive: true });
			mkdirSync(adminDir, { recursive: true });

			createOpenApiFile(apiDir, [{ method: 'GET', path: '/users' }]);

			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: ['api'],
						client: { output: 'src/api' },
						resolvedDeployTarget: 'dokploy',
					},
					admin: {
						type: 'frontend',
						path: 'apps/admin',
						port: 3002,
						dependencies: ['api'],
						client: { output: 'lib/client' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await copyClientToFrontends(workspace, 'api', {
				silent: true,
			});

			expect(results).toHaveLength(2);
			expect(results.every((r) => r.success)).toBe(true);
			expect(existsSync(join(webDir, 'src/api/api.ts'))).toBe(true);
			expect(existsSync(join(adminDir, 'lib/client/api.ts'))).toBe(true);
		});

		it('should add header comment to copied file', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createOpenApiFile(apiDir, [{ method: 'GET', path: '/users' }]);

			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: ['api'],
						client: { output: 'src/api' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			await copyClientToFrontends(workspace, 'api', { silent: true });

			const content = readFileSync(join(webDir, 'src/api/api.ts'), 'utf-8');
			expect(content).toContain('Auto-generated API client for api');
			expect(content).toContain('DO NOT EDIT');
		});

		it('should use backend name in filename when frontend has multiple backends', async () => {
			const apiDir = join(testDir, 'apps/api');
			const authDir = join(testDir, 'apps/auth');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createOpenApiFile(apiDir, [{ method: 'GET', path: '/users' }]);
			createOpenApiFile(authDir, [{ method: 'POST', path: '/login' }]);

			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3001,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api', 'auth'], // Multiple backends
						client: { output: 'src/api' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			await copyClientToFrontends(workspace, 'api', { silent: true });
			await copyClientToFrontends(workspace, 'auth', { silent: true });

			// Should use {backend}.ts naming
			expect(existsSync(join(webDir, 'src/api/api.ts'))).toBe(true);
			expect(existsSync(join(webDir, 'src/api/auth.ts'))).toBe(true);
		});
	});

	describe('copyAllClients', () => {
		let testDir: string;

		beforeEach(() => {
			testDir = join(
				tmpdir(),
				`gkm-client-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		function createOpenApiFile(
			appDir: string,
			endpoints: Array<{ method: string; path: string }>,
		): void {
			const endpointAuthEntries = endpoints
				.map((ep) => `  '${ep.method.toUpperCase()} ${ep.path}': null,`)
				.join('\n');

			const content = `// Auto-generated by @geekmidas/cli - DO NOT EDIT

export const endpointAuth = {
${endpointAuthEntries}
} as const;

export const paths = {};
export function createApi() { return {}; }
`;

			const gkmDir = join(appDir, '.gkm');
			mkdirSync(gkmDir, { recursive: true });
			writeFileSync(join(gkmDir, 'openapi.ts'), content);
		}

		it('should copy from all backends to their dependent frontends', async () => {
			const apiDir = join(testDir, 'apps/api');
			const authDir = join(testDir, 'apps/auth');
			const webDir = join(testDir, 'apps/web');
			const adminDir = join(testDir, 'apps/admin');
			mkdirSync(webDir, { recursive: true });
			mkdirSync(adminDir, { recursive: true });

			createOpenApiFile(apiDir, [{ method: 'GET', path: '/users' }]);
			createOpenApiFile(authDir, [{ method: 'POST', path: '/login' }]);

			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3001,
						dependencies: [],
						routes: './src/endpoints/**/*.ts',
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api'],
						client: { output: 'src/api' },
						resolvedDeployTarget: 'dokploy',
					},
					admin: {
						type: 'frontend',
						path: 'apps/admin',
						port: 3003,
						dependencies: ['auth'],
						client: { output: 'lib/client' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await copyAllClients(workspace, { silent: true });

			expect(results).toHaveLength(2);
			expect(results.every((r) => r.success)).toBe(true);
			expect(existsSync(join(webDir, 'src/api/api.ts'))).toBe(true);
			expect(existsSync(join(adminDir, 'lib/client/auth.ts'))).toBe(true);
		});

		it('should return empty array when no backends have routes', async () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
				apps: {
					worker: {
						type: 'backend',
						path: 'apps/worker',
						port: 3000,
						dependencies: [],
						// No routes
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const results = await copyAllClients(workspace, { silent: true });

			expect(results).toEqual([]);
		});
	});
});
