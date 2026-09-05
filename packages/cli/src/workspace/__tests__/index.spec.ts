import { describe, expect, it } from 'vitest';
import type { GkmConfig } from '../../types.ts';
import {
	defineWorkspace,
	getAppBuildOrder,
	getAppGkmConfig,
	getDependencyEnvVars,
	getEndpointForStage,
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

	it('should pass through state config when specified', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
			state: {
				provider: 'ssm',
				region: 'us-east-1',
			},
		};

		const result = normalizeWorkspace(config, '/project');

		expect(result.state).toEqual({
			provider: 'ssm',
			region: 'us-east-1',
		});
	});

	it('should leave state undefined when not specified', () => {
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

		expect(result.state).toBeUndefined();
	});

	it('should pass through local state config', () => {
		const config: WorkspaceConfig = {
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					routes: './src/**/*.ts',
				},
			},
			state: {
				provider: 'local',
			},
		};

		const result = normalizeWorkspace(config, '/project');

		expect(result.state).toEqual({ provider: 'local' });
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

	it('does not let a compose list decide which services exist', () => {
		// It used to seed `services.db` and `services.cache` from here, which is
		// to say a container existed because a deploy-side list named it. Which
		// containers exist is the manifest's answer — a declared database implies
		// Postgres — so this block is left to be what its name says.
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

		expect(result.services).toEqual({});
	});

	it('carries the constructs glob through', () => {
		// Reconcile derives the local containers from this glob, so dropping it
		// here is the difference between a single-app project deriving its
		// Postgres and silently getting none.
		const config: GkmConfig = {
			constructs: './src/constructs/**/*.ts',
			routes: './src/endpoints/**/*.ts',
			envParser: './src/env',
			logger: './src/logger',
		};

		const result = wrapSingleAppAsWorkspace(config, '/project');

		expect(result.apps.api.constructs).toBe('./src/constructs/**/*.ts');
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

	it('carries a single-app config’s deploy settings through the wrap', () => {
		// The wrap used to hardcode `{ default: 'dokploy' }` and drop the rest, so
		// a single-app project had nowhere to put an endpoint, a registry or a
		// domain — and `resolveHost` refused to name a host for a stage the config
		// could not describe.
		const wrapped = wrapSingleAppAsWorkspace(
			{
				routes: './src/**/*.ts',
				deploy: {
					default: 'dokploy',
					dokploy: {
						endpoint: 'http://example:3000',
						domains: { production: 'example.test' },
					},
				},
			} as never,
			'/project',
		);

		expect(wrapped.deploy.dokploy?.domains?.production).toBe('example.test');
		expect(wrapped.deploy.default).toBe('dokploy');
	});

	it('carries the workspace backends onto the app config', () => {
		// The entry point reads these to decide which drivers to register, while
		// the local target reads the same field to compose the URLs those drivers
		// receive. Dropping them here is how an app on `cache: 'db'` was handed a
		// `postgres://` URL by an entry that had registered only Upstash.
		const config: WorkspaceConfig = {
			services: { cache: 'db', mail: 'ses' },
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

		expect(getAppGkmConfig(workspace, 'api')?.services).toEqual({
			cache: 'db',
			mail: 'ses',
		});
	});

	it('should return undefined for frontend app', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'web',
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
					type: 'web',
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
					type: 'web',
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
			NEXT_PUBLIC_API_URL: 'http://localhost:3000',
			AUTH_URL: 'http://localhost:3002',
			NEXT_PUBLIC_AUTH_URL: 'http://localhost:3002',
		});
	});

	it('should use custom URL prefix', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'web',
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
			NEXT_PUBLIC_API_URL: 'https://internal:3000',
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

	it('should emit VITE_ prefix for vite apps', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 5173,
					framework: 'vite',
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
		const envVars = getDependencyEnvVars(workspace, 'web');

		expect(envVars).toEqual({
			API_URL: 'http://localhost:3000',
			VITE_API_URL: 'http://localhost:3000',
		});
		expect(envVars.NEXT_PUBLIC_API_URL).toBeUndefined();
	});

	it('should emit VITE_ prefix for tanstack-start apps', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3000,
					framework: 'tanstack-start',
					dependencies: ['api', 'auth'],
				},
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3001,
					routes: './src/**/*.ts',
				},
				auth: {
					type: 'backend',
					path: 'apps/auth',
					port: 3002,
					entry: './src/index.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const envVars = getDependencyEnvVars(workspace, 'web');

		expect(envVars).toEqual({
			API_URL: 'http://localhost:3001',
			VITE_API_URL: 'http://localhost:3001',
			AUTH_URL: 'http://localhost:3002',
			VITE_AUTH_URL: 'http://localhost:3002',
		});
	});

	it('should emit only un-prefixed URLs for remix apps', () => {
		const config: WorkspaceConfig = {
			apps: {
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3000,
					framework: 'remix',
					dependencies: ['api'],
				},
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3001,
					routes: './src/**/*.ts',
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const envVars = getDependencyEnvVars(workspace, 'web');

		expect(envVars).toEqual({
			API_URL: 'http://localhost:3001',
		});
	});
});

describe('getEndpointForStage', () => {
	it('should return per-stage endpoint when available', () => {
		const config = {
			endpoints: {
				development: 'https://dev.dokploy.example.com:3000',
				production: 'https://prod.dokploy.example.com:3000',
			},
		};

		expect(getEndpointForStage(config, 'production')).toBe(
			'https://prod.dokploy.example.com:3000',
		);
		expect(getEndpointForStage(config, 'development')).toBe(
			'https://dev.dokploy.example.com:3000',
		);
	});

	it('should fall back to global endpoint when per-stage not found', () => {
		const config = {
			endpoint: 'https://dokploy.example.com:3000',
			endpoints: {
				development: 'https://dev.dokploy.example.com:3000',
			},
		};

		expect(getEndpointForStage(config, 'production')).toBe(
			'https://dokploy.example.com:3000',
		);
	});

	it('should return global endpoint when only endpoint is configured', () => {
		const config = {
			endpoint: 'https://dokploy.example.com:3000',
		};

		expect(getEndpointForStage(config, 'production')).toBe(
			'https://dokploy.example.com:3000',
		);
		expect(getEndpointForStage(config, 'development')).toBe(
			'https://dokploy.example.com:3000',
		);
	});

	it('should return undefined when config is undefined', () => {
		expect(getEndpointForStage(undefined, 'production')).toBeUndefined();
	});

	it('should return undefined when neither endpoint nor endpoints is configured', () => {
		const config = {};

		expect(getEndpointForStage(config, 'production')).toBeUndefined();
	});

	it('should prefer per-stage endpoint over global endpoint', () => {
		const config = {
			endpoint: 'https://global.example.com:3000',
			endpoints: {
				production: 'https://prod.example.com:3000',
			},
		};

		expect(getEndpointForStage(config, 'production')).toBe(
			'https://prod.example.com:3000',
		);
	});
});

/**
 * A single-app config is a one-app workspace, and the projection has to be
 * faithful.
 *
 * `defineConfig` stays as the authoring surface, but there is one internal
 * model. What made that a fiction rather than a fact was the fields this
 * dropped on the way: every hardcoded value below was something the config
 * could already state.
 */
describe('a single-app config as a workspace', () => {
	const base = {
		routes: './src/**/*.ts',
		envParser: './src/env',
		logger: './src/logger',
	} as GkmConfig;

	it('deploys where the config says, not always to Dokploy', () => {
		// The worst of the dropped fields: a project deploying to Vercel was
		// normalised into one that deploys to Dokploy, and nothing said so.
		const result = wrapSingleAppAsWorkspace(
			{ ...base, deploy: { default: 'vercel' } } as GkmConfig,
			'/project',
		);

		expect(result.apps.api?.resolvedDeployTarget).toBe('vercel');
	});

	it('serves on the port the config names', () => {
		const result = wrapSingleAppAsWorkspace(
			{ ...base, providers: { server: { port: 4000 } } } as GkmConfig,
			'/project',
		);

		expect(result.apps.api?.port).toBe(4000);
	});

	it('still has a port when `server: true` names none', () => {
		const result = wrapSingleAppAsWorkspace(
			{ ...base, providers: { server: true } } as GkmConfig,
			'/project',
		);

		expect(result.apps.api?.port).toBe(3000);
	});

	it('takes its name from the config, the way a workspace does', () => {
		expect(
			wrapSingleAppAsWorkspace({ ...base, name: 'acme' } as GkmConfig, '/p')
				.name,
		).toBe('acme');
	});

	it('keys its one app the way a workspace would', () => {
		// The key is what names the application — `production-acme-api`, beside
		// the `production-acme-database` its constructs get. The deploy asks the
		// workspace what its apps are called rather than asking the filesystem.
		const result = wrapSingleAppAsWorkspace(base, '/project');

		expect(Object.keys(result.apps)).toEqual(['api']);
		expect(result.apps.api?.type).toBe('backend');
	});
});
