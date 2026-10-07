import { describe, expect, it } from 'vitest';
import type { GkmConfig } from '../../types.ts';
import {
	DokployRegistryMoved,
	defineWorkspace,
	getAppBuildOrder,
	getAppGkmConfig,
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
			apps: { api: { type: 'backend' } },
		} as unknown as WorkspaceConfig;

		expect(() => defineWorkspace(config)).toThrow(
			'Workspace configuration validation failed',
		);
	});

	it('accepts a workspace whose apps are all declared', () => {
		// No `apps` block at all: a `site` is an app and so is a `rest-api` that
		// named one, so the list is read off the graph rather than written here.
		const config = {
			stages: { local: 'development', deployed: ['production'] },
			name: 'shop',
			constructs: './constructs/**/*.ts',
		} as WorkspaceConfig;

		expect(() => defineWorkspace(config)).not.toThrow();
	});

	it('should allow backend apps without routes (e.g., auth servers)', () => {
		const config = {
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
		expect(result.deploy).toEqual({ default: 'dokploy' });
		expect(result.shared).toEqual({ packages: ['packages/*'] });
		expect(result.secrets).toEqual({});
	});

	it('should use provided name', () => {
		const config: WorkspaceConfig = {
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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

		expect(result.apps.api.telescope).toEqual({ enabled: true });
		expect(result.apps.api.openapi).toEqual({ enabled: true });
	});

	it('should resolve deploy target to dokploy by default', () => {
		const config: WorkspaceConfig = {
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
		expect(result.apps.api.telescope).toBe(true);
	});

	it('carries the constructs glob through', () => {
		// Reconcile derives the local containers from this glob, so dropping it
		// here is the difference between a single-app project deriving its
		// Postgres and silently getting none.
		const config: GkmConfig = {
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
		const config = {
			stages: { local: 'development', deployed: ['production'] },
			apps: { api: { type: 'backend' } },
		} as unknown as WorkspaceConfig;

		expect(() => processConfig(config, '/project')).toThrow(
			'Workspace configuration validation failed',
		);
	});
});

describe('getAppGkmConfig', () => {
	it('should return GkmConfig for backend app', () => {
		const config: WorkspaceConfig = {
			stages: { local: 'development', deployed: ['production'] },
			constructs: './constructs/**/*.ts',
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					telescope: true,
				},
			},
		};

		const workspace = normalizeWorkspace(config, '/project');
		const gkmConfig = getAppGkmConfig(workspace, 'api');

		expect(gkmConfig).toBeDefined();
		// One glob, and what it finds is decided by the values it exports.
		expect(gkmConfig?.constructs).toEqual(['/project/constructs/**/*.ts']);
		expect(gkmConfig?.telescope).toBe(true);
		// The surface holds these now; a projection has nothing to say about
		// them.
		expect('routes' in gkmConfig!).toBe(false);
		expect('envParser' in gkmConfig!).toBe(false);
		expect('logger' in gkmConfig!).toBe(false);
	});

	it('carries a single-app config’s deploy settings through the wrap', () => {
		// The wrap used to hardcode `{ default: 'dokploy' }` and drop the rest, so
		// a single-app project had nowhere to put an endpoint, a registry or a
		// domain — and `resolveHost` refused to name a host for a stage the config
		// could not describe.
		const wrapped = wrapSingleAppAsWorkspace(
			{
				stages: { local: 'development', deployed: ['production'] },
				routes: './src/**/*.ts',
				deploy: {
					default: 'dokploy',
					domains: { production: 'example.test' },
					dokploy: { endpoint: 'http://example:3000' },
				},
			} as never,
			'/project',
		);

		expect(wrapped.deploy.domains?.production).toBe('example.test');
		expect(wrapped.deploy.default).toBe('dokploy');
	});

	it('carries the deploy target onto the app config', () => {
		// The entry point decides which cache driver to register from the
		// target, and the local target composes the URL from the same target.
		// Dropping it here is how an app on a server was handed a
		// `postgres://` cache URL by an entry that registered only Upstash.
		const config: WorkspaceConfig = {
			stages: { local: 'development', deployed: ['production'] },
			deploy: { default: 'dokploy' },
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

		expect(getAppGkmConfig(workspace, 'api')?.deploy).toEqual({
			default: 'dokploy',
		});
	});

	it('should return undefined for frontend app', () => {
		const config: WorkspaceConfig = {
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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

describe('getEndpointForStage', () => {
	it('should return per-stage endpoint when available', () => {
		const config = {
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
			stages: { local: 'development', deployed: ['production'] },
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
		stages: { local: 'development', deployed: ['production'] },
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

describe('deploy.registry', () => {
	const stages = { local: 'development', deployed: ['production'] };

	it('is read from deploy, for every target', () => {
		const { workspace } = processConfig(
			{
				stages,
				apps: {},
				deploy: {
					registry: 'ghcr.io/acme',
					dokploy: { endpoint: 'https://dokploy.example.com' },
				},
			} as WorkspaceConfig,
			'/project',
		);

		expect(workspace.deploy.registry).toBe('ghcr.io/acme');
	});

	it('refuses deploy.dokploy.registry, saying where it moved', () => {
		const config = {
			stages,
			apps: {},
			deploy: {
				dokploy: {
					endpoint: 'https://dokploy.example.com',
					registry: 'ghcr.io/acme',
				},
			},
		};

		let error: unknown;
		try {
			processConfig(config as never, '/project');
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(DokployRegistryMoved);
		expect((error as DokployRegistryMoved).registry).toBe('ghcr.io/acme');
		expect((error as Error).message).toContain(
			'deploy: { registry: "ghcr.io/acme"',
		);
		expect(() => defineWorkspace(config as never)).toThrow(
			DokployRegistryMoved,
		);
	});

	it('refuses it in a single-app config too', () => {
		expect(() =>
			processConfig(
				{
					stages,
					routes: './src/**/*.ts',
					deploy: { dokploy: { registry: 'ghcr.io/acme' } },
				} as never,
				'/project',
			),
		).toThrow(DokployRegistryMoved);
	});
});
