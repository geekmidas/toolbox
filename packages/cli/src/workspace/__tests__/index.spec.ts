import { describe, expect, it } from 'vitest';
import type { GkmConfig } from '../../types.ts';
import {
	defineWorkspace,
	getAppBuildOrder,
	getAppGkmConfig,
	getDependencyEnvVars,
	isWorkspaceConfig,
	normalizeWorkspace,
	processConfig,
	wrapSingleAppAsWorkspace,
} from '../index.ts';
import type { WorkspaceConfig } from '../types.ts';

describe('defineWorkspace', () => {
	it('should return valid workspace config unchanged', () => {
		const config: WorkspaceConfig = {
			name: 'my-saas',
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/endpoints/**/*.ts',
				},
			},
		};

		const result = defineWorkspace(config);

		expect(result).toEqual(config);
	});

	it('should throw on invalid config', () => {
		const config = {
			apps: {},
		} as WorkspaceConfig;

		expect(() => defineWorkspace(config)).toThrow(
			'Workspace configuration validation failed',
		);
	});

	it('should allow backend apps without routes (e.g., auth servers)', () => {
		const config = {
			apps: {
				auth: {
					type: 'backend',
					path: 'apps/auth',
					port: 3000,
				},
			},
		} as WorkspaceConfig;

		// Should not throw - routes are optional for backend apps
		expect(() => defineWorkspace(config)).not.toThrow();
	});
});

describe('isWorkspaceConfig', () => {
	it('should return true for workspace config', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		expect(isWorkspaceConfig(config)).toBe(true);
	});

	it('should return false for single-app GkmConfig', () => {
		const config: GkmConfig = {
			routes: './src/endpoints/**/*.ts',
			envParser: './src/config/env',
			logger: './src/logger',
		};

		expect(isWorkspaceConfig(config)).toBe(false);
	});

	it('should return false for null', () => {
		expect(isWorkspaceConfig(null as unknown as GkmConfig)).toBe(false);
	});
});

describe('normalizeWorkspace', () => {
	it('should normalize workspace with defaults', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		const result = normalizeWorkspace(config, '/project');

		expect(result.root).toBe('/project');
		expect(result.apps.api.type).toBe('backend');
		expect(result.apps.api.dependencies).toEqual([]);
		expect(result.services).toEqual({});
		expect(result.deploy).toEqual({ default: 'dokploy' });
		expect(result.shared).toEqual({ packages: ['packages/*'] });
		expect(result.secrets).toEqual({});
	});

	it('should use provided name', () => {
		const config: WorkspaceConfig = {
			name: 'custom-name',
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		const result = normalizeWorkspace(config, '/project');

		expect(result.name).toBe('custom-name');
	});

	it('should preserve all app properties', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
					envParser: './src/env',
					logger: './src/logger',
					telescope: { enabled: true },
					openapi: { enabled: true },
				},
			},
		};

		const result = normalizeWorkspace(config, '/project');

		expect(result.apps.api.envParser).toBe('./src/env');
		expect(result.apps.api.logger).toBe('./src/logger');
		expect(result.apps.api.telescope).toEqual({ enabled: true });
		expect(result.apps.api.openapi).toEqual({ enabled: true });
	});

	it('should resolve deploy target to dokploy by default', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		const result = normalizeWorkspace(config, '/project');

		expect(result.apps.api.resolvedDeployTarget).toBe('dokploy');
	});

	it('should use deploy.default as fallback for resolvedDeployTarget', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
			deploy: {
				default: 'dokploy',
			},
		};

		const result = normalizeWorkspace(config, '/project');

		expect(result.apps.api.resolvedDeployTarget).toBe('dokploy');
	});

	it('should use per-app deploy target when specified', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
					deploy: 'dokploy',
				},
			},
			deploy: {
				default: 'dokploy',
			},
		};

		const result = normalizeWorkspace(config, '/project');

		expect(result.apps.api.resolvedDeployTarget).toBe('dokploy');
	});
});

describe('wrapSingleAppAsWorkspace', () => {
	it('should wrap single-app config as workspace', () => {
		const config: GkmConfig = {
			routes: './src/endpoints/**/*.ts',
			envParser: './src/config/env',
			logger: './src/logger',
			telescope: true,
			openapi: { enabled: true },
		};

		const result = wrapSingleAppAsWorkspace(config, '/project/myapp');

		expect(result.name).toBe('myapp');
		expect(result.root).toBe('/project/myapp');
		expect(result.apps.api).toBeDefined();
		expect(result.apps.api.type).toBe('backend');
		expect(result.apps.api.path).toBe('.');
		expect(result.apps.api.port).toBe(3000);
		expect(result.apps.api.routes).toBe('./src/endpoints/**/*.ts');
		expect(result.apps.api.envParser).toBe('./src/config/env');
		expect(result.apps.api.logger).toBe('./src/logger');
		expect(result.apps.api.telescope).toBe(true);
	});

	it('should extract docker compose services', () => {
		const config: GkmConfig = {
			routes: './src/**/*.ts',
			envParser: './src/env',
			logger: './src/logger',
			docker: {
				compose: {
					services: ['postgres', 'redis'],
				},
			},
		};

		const result = wrapSingleAppAsWorkspace(config, '/project');

		expect(result.services.db).toBe(true);
		expect(result.services.cache).toBe(true);
	});

	it('should set resolvedDeployTarget to dokploy', () => {
		const config: GkmConfig = {
			routes: './src/**/*.ts',
			envParser: './src/env',
			logger: './src/logger',
		};

		const result = wrapSingleAppAsWorkspace(config, '/project');

		expect(result.apps.api.resolvedDeployTarget).toBe('dokploy');
	});
});

describe('processConfig', () => {
	it('should process workspace config', () => {
		const config: WorkspaceConfig = {
			name: 'test-workspace',
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		const result = processConfig(config, '/project');

		expect(result.type).toBe('workspace');
		expect(result.raw).toBe(config);
		expect(result.workspace.name).toBe('test-workspace');
	});

	it('should process single-app config', () => {
		const config: GkmConfig = {
			routes: './src/**/*.ts',
			envParser: './src/env',
			logger: './src/logger',
		};

		const result = processConfig(config, '/project/myapp');

		expect(result.type).toBe('single');
		expect(result.raw).toBe(config);
		expect(result.workspace.apps.api).toBeDefined();
	});

	it('should throw on invalid workspace config', () => {
		const config: WorkspaceConfig = {
			apps: {},
		};

		expect(() => processConfig(config, '/project')).toThrow(
			'Workspace configuration validation failed',
		);
	});
});

describe('getAppGkmConfig', () => {
	it('should return GkmConfig for backend app', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
					envParser: './src/env',
					logger: './src/logger',
					telescope: true,
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const gkmConfig = getAppGkmConfig(workspace, 'api');

		expect(gkmConfig).toBeDefined();
		expect(gkmConfig?.routes).toBe('./src/**/*.ts');
		expect(gkmConfig?.envParser).toBe('./src/env');
		expect(gkmConfig?.logger).toBe('./src/logger');
		expect(gkmConfig?.telescope).toBe(true);
	});

	it('should return undefined for frontend app', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					framework: 'nextjs',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const gkmConfig = getAppGkmConfig(workspace, 'web');

		expect(gkmConfig).toBeUndefined();
	});

	it('should return undefined for non-existent app', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const gkmConfig = getAppGkmConfig(workspace, 'nonexistent');

		expect(gkmConfig).toBeUndefined();
	});
});

describe('getAppBuildOrder', () => {
	it('should return apps in dependency order', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					framework: 'nextjs',
					dependencies: ['api'],
				},
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
					dependencies: ['worker'],
				},
				worker: {
					type: 'backend',
					path: 'apps/worker',
					port: 3002,
					routes: './src/**/*.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const order = getAppBuildOrder(workspace);

		const workerIndex = order.indexOf('worker');
		const apiIndex = order.indexOf('api');
		const webIndex = order.indexOf('web');

		expect(workerIndex).toBeLessThan(apiIndex);
		expect(apiIndex).toBeLessThan(webIndex);
	});

	it('should handle apps without dependencies', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
				worker: {
					type: 'backend',
					path: 'apps/worker',
					port: 3001,
					routes: './src/**/*.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const order = getAppBuildOrder(workspace);

		expect(order).toHaveLength(2);
		expect(order).toContain('api');
		expect(order).toContain('worker');
	});
});

describe('getDependencyEnvVars', () => {
	it('should generate env vars for dependencies', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					framework: 'nextjs',
					dependencies: ['api', 'auth'],
				},
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
				auth: {
					type: 'backend',
					path: 'apps/auth',
					port: 3002,
					routes: './src/**/*.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const envVars = getDependencyEnvVars(workspace, 'web');

		expect(envVars).toEqual({
			API_URL: 'http://localhost:3000',
			AUTH_URL: 'http://localhost:3002',
		});
	});

	it('should use custom URL prefix', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					framework: 'nextjs',
					dependencies: ['api'],
				},
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const envVars = getDependencyEnvVars(workspace, 'web', 'https://internal');

		expect(envVars).toEqual({
			API_URL: 'https://internal:3000',
		});
	});

	it('should return empty object for app without dependencies', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const envVars = getDependencyEnvVars(workspace, 'api');

		expect(envVars).toEqual({});
	});

	it('should return empty object for non-existent app', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const envVars = getDependencyEnvVars(workspace, 'nonexistent');

		expect(envVars).toEqual({});
	});
});
