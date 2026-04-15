import { describe, expect, it } from 'vitest';
import {
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
});
