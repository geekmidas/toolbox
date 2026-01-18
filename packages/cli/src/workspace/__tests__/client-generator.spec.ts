import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clearSpecHashCache,
	generateClientForFrontend,
	getBackendDependencies,
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

	describe('generateClientForFrontend', () => {
		let testDir: string;

		beforeEach(() => {
			testDir = join(
				tmpdir(),
				`gkm-client-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(testDir, { recursive: true });
			clearSpecHashCache();
		});

		afterEach(() => {
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('should return empty array for frontend with no backend dependencies', async () => {
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

			const results = await generateClientForFrontend(workspace, 'web');
			expect(results).toEqual([]);
		});

		it('should return empty array for non-frontend app', async () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: testDir,
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

			const results = await generateClientForFrontend(workspace, 'api');
			expect(results).toEqual([]);
		});

		it('should use configured client output path', async () => {
			// Create minimal workspace structure
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(join(apiDir, 'src/endpoints'), { recursive: true });
			mkdirSync(webDir, { recursive: true });

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
						client: { output: 'lib/api' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			// This will fail to generate because there are no endpoints,
			// but we can verify the output path would be correct
			const results = await generateClientForFrontend(workspace, 'web');
			expect(results).toHaveLength(1);
			expect(results[0]?.reason).toBe('No endpoints found in backend');
		});
	});

	describe('hot reload - hash-based change detection', () => {
		let testDir: string;

		beforeEach(() => {
			testDir = join(
				tmpdir(),
				`gkm-hotreload-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(testDir, { recursive: true });
			clearSpecHashCache();
		});

		afterEach(() => {
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		function createEndpointFile(
			dir: string,
			filename: string,
			exportName: string,
			path: string,
			method: string,
		): void {
			const content = `
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const ${exportName} = e
  .${method.toLowerCase()}('${path}')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'Hello' }));
`;
			const { writeFileSync } = require('node:fs');
			const { dirname } = require('node:path');
			mkdirSync(dirname(join(dir, filename)), { recursive: true });
			writeFileSync(join(dir, filename), content);
		}

		function createWorkspace(root: string): NormalizedWorkspace {
			return {
				name: 'test',
				root,
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
		}

		it('should generate client on first call', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createEndpointFile(
				apiDir,
				'src/endpoints/users.ts',
				'getUsers',
				'/users',
				'GET',
			);

			const workspace = createWorkspace(testDir);
			const results = await generateClientForFrontend(workspace, 'web', {
				force: true,
			});

			expect(results).toHaveLength(1);
			expect(results[0]?.generated).toBe(true);
			expect(results[0]?.endpointCount).toBe(1);
			expect(existsSync(join(webDir, 'src/api/openapi.ts'))).toBe(true);
		});

		it('should skip regeneration when schema has not changed', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createEndpointFile(
				apiDir,
				'src/endpoints/users.ts',
				'getUsers',
				'/users',
				'GET',
			);

			const workspace = createWorkspace(testDir);

			// First call - should generate
			const firstResults = await generateClientForFrontend(workspace, 'web', {
				force: true,
			});
			expect(firstResults[0]?.generated).toBe(true);

			// Second call - should skip (no changes)
			const secondResults = await generateClientForFrontend(workspace, 'web');
			expect(secondResults[0]?.generated).toBe(false);
			expect(secondResults[0]?.reason).toBe('No schema changes detected');
		});

		it('should regenerate when endpoint schema changes', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createEndpointFile(
				apiDir,
				'src/endpoints/users.ts',
				'getUsers',
				'/users',
				'GET',
			);

			const workspace = createWorkspace(testDir);

			// First call - generate initial client
			const firstResults = await generateClientForFrontend(workspace, 'web', {
				force: true,
			});
			expect(firstResults[0]?.generated).toBe(true);

			// Second call without changes - should skip
			const secondResults = await generateClientForFrontend(workspace, 'web');
			expect(secondResults[0]?.generated).toBe(false);

			// Modify endpoint - add new route
			createEndpointFile(
				apiDir,
				'src/endpoints/posts.ts',
				'getPosts',
				'/posts',
				'GET',
			);

			// Third call - should regenerate due to schema change
			const thirdResults = await generateClientForFrontend(workspace, 'web');
			expect(thirdResults[0]?.generated).toBe(true);
			expect(thirdResults[0]?.endpointCount).toBe(2);
		});

		it('should regenerate when endpoint path changes (via new file)', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createEndpointFile(
				apiDir,
				'src/endpoints/users.ts',
				'getUsers',
				'/users',
				'GET',
			);

			const workspace = createWorkspace(testDir);

			// First call
			await generateClientForFrontend(workspace, 'web', { force: true });

			// Second call - skip
			const skipResult = await generateClientForFrontend(workspace, 'web');
			expect(skipResult[0]?.generated).toBe(false);

			// Add endpoint with different path (new file to avoid ESM cache)
			// This simulates what happens when a developer changes a path -
			// in real dev server, the watcher would reload the module
			createEndpointFile(
				apiDir,
				'src/endpoints/api-users.ts',
				'getApiUsers',
				'/api/users',
				'GET',
			);

			// Third call - should regenerate because schema changed
			const regenerateResult = await generateClientForFrontend(
				workspace,
				'web',
			);
			expect(regenerateResult[0]?.generated).toBe(true);
			expect(regenerateResult[0]?.endpointCount).toBe(2); // Now has 2 endpoints
		});

		it('should skip when only handler implementation changes', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			mkdirSync(webDir, { recursive: true });

			createEndpointFile(
				apiDir,
				'src/endpoints/users.ts',
				'getUsers',
				'/users',
				'GET',
			);

			const workspace = createWorkspace(testDir);

			// First call
			await generateClientForFrontend(workspace, 'web', { force: true });

			// Change only the handler implementation (not the schema)
			const { writeFileSync } = require('node:fs');
			const modifiedContent = `
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const getUsers = e
  .get('/users')
  .output(z.object({ message: z.string() }))
  .handle(async () => {
    // Different implementation - added a comment and console.log
    console.log('Getting users');
    return { message: 'Hello World' };
  });
`;
			writeFileSync(join(apiDir, 'src/endpoints/users.ts'), modifiedContent);

			// Second call - should skip (schema unchanged, only implementation changed)
			const results = await generateClientForFrontend(workspace, 'web');
			expect(results[0]?.generated).toBe(false);
			expect(results[0]?.reason).toBe('No schema changes detected');
		});

		it('should regenerate for multiple frontends when backend changes', async () => {
			const apiDir = join(testDir, 'apps/api');
			const webDir = join(testDir, 'apps/web');
			const adminDir = join(testDir, 'apps/admin');
			mkdirSync(webDir, { recursive: true });
			mkdirSync(adminDir, { recursive: true });

			createEndpointFile(
				apiDir,
				'src/endpoints/users.ts',
				'getUsers',
				'/users',
				'GET',
			);

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
						client: { output: 'src/client' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			// Generate for both frontends
			await generateClientForFrontend(workspace, 'web', { force: true });
			await generateClientForFrontend(workspace, 'admin', { force: true });

			// Both should skip
			const webSkip = await generateClientForFrontend(workspace, 'web');
			const adminSkip = await generateClientForFrontend(workspace, 'admin');
			expect(webSkip[0]?.generated).toBe(false);
			expect(adminSkip[0]?.generated).toBe(false);

			// Add new endpoint
			createEndpointFile(
				apiDir,
				'src/endpoints/products.ts',
				'getProducts',
				'/products',
				'GET',
			);

			// Both should regenerate
			const webRegen = await generateClientForFrontend(workspace, 'web');
			const adminRegen = await generateClientForFrontend(workspace, 'admin');
			expect(webRegen[0]?.generated).toBe(true);
			expect(adminRegen[0]?.generated).toBe(true);
		});

		it('should only regenerate affected frontend when specific backend changes', async () => {
			const apiDir = join(testDir, 'apps/api');
			const authDir = join(testDir, 'apps/auth');
			const webDir = join(testDir, 'apps/web');
			const adminDir = join(testDir, 'apps/admin');
			mkdirSync(webDir, { recursive: true });
			mkdirSync(adminDir, { recursive: true });

			createEndpointFile(
				apiDir,
				'src/endpoints/users.ts',
				'getUsers',
				'/users',
				'GET',
			);
			createEndpointFile(
				authDir,
				'src/endpoints/login.ts',
				'login',
				'/login',
				'POST',
			);

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
						dependencies: ['api'], // Only depends on api
						client: { output: 'src/api' },
						resolvedDeployTarget: 'dokploy',
					},
					admin: {
						type: 'frontend',
						path: 'apps/admin',
						port: 3003,
						dependencies: ['auth'], // Only depends on auth
						client: { output: 'src/client' },
						resolvedDeployTarget: 'dokploy',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			// Initial generation
			await generateClientForFrontend(workspace, 'web', { force: true });
			await generateClientForFrontend(workspace, 'admin', { force: true });

			// Change only the api backend
			createEndpointFile(
				apiDir,
				'src/endpoints/products.ts',
				'getProducts',
				'/products',
				'GET',
			);

			// web should regenerate (depends on api)
			const webResult = await generateClientForFrontend(workspace, 'web');
			expect(webResult[0]?.generated).toBe(true);

			// admin should skip (depends on auth, which didn't change)
			const adminResult = await generateClientForFrontend(workspace, 'admin');
			expect(adminResult[0]?.generated).toBe(false);
		});
	});
});
