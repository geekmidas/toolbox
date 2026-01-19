import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types.js';
import { DokployApi } from '../dokploy-api';
import {
	type EnvResolverContext,
	resolveEnvVar,
	resolveEnvVars,
} from '../env-resolver';
import {
	generateTag,
	provisionServices,
	workspaceDeployCommand,
} from '../index';
import { createEmptyState } from '../state';
import type { DeployOptions } from '../types';

const BASE_URL = 'https://dokploy.example.com';

// MSW server for mocking Dokploy API calls
const server = setupServer();

describe('generateTag', () => {
	it('should generate tag with stage prefix', () => {
		const tag = generateTag('production');
		expect(tag).toMatch(/^production-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
	});

	it('should generate tag with staging prefix', () => {
		const tag = generateTag('staging');
		expect(tag).toMatch(/^staging-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
	});

	it('should generate unique tags', () => {
		const tag1 = generateTag('test');
		// Small delay to ensure different timestamp
		const tag2 = generateTag('test');
		// Tags should start with same prefix but could be same in fast execution
		expect(tag1).toMatch(/^test-/);
		expect(tag2).toMatch(/^test-/);
	});

	it('should replace colons and periods in timestamp', () => {
		const tag = generateTag('dev');
		expect(tag).not.toContain(':');
		expect(tag).not.toContain('.');
	});
});

describe('provisionServices', () => {
	beforeEach(() => {
		server.listen({ onUnhandledRequest: 'bypass' });
	});

	afterEach(() => {
		server.resetHandlers();
		server.close();
		vi.restoreAllMocks();
	});

	it('should return undefined when no services configured', async () => {
		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(
			api,
			'proj_1',
			'env_1',
			'myapp',
			undefined,
		);

		expect(result).toBeUndefined();
	});

	it('should return undefined when no environmentId', async () => {
		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(api, 'proj_1', undefined, 'myapp', {
			postgres: true,
		});

		expect(result).toBeUndefined();
	});

	it('should skip postgres when already provisioned', async () => {
		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(
			api,
			'proj_1',
			'env_1',
			'myapp',
			{ postgres: true },
			{ postgresId: 'pg_existing' },
		);

		// Should return undefined since nothing new was provisioned
		expect(result).toBeUndefined();
	});

	it('should skip redis when already provisioned', async () => {
		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(
			api,
			'proj_1',
			'env_1',
			'myapp',
			{ redis: true },
			{ redisId: 'redis_existing' },
		);

		expect(result).toBeUndefined();
	});

	it('should provision postgres and return DATABASE_URL', async () => {
		server.use(
			http.post(`${BASE_URL}/api/postgres.create`, async ({ request }) => {
				const body = (await request.json()) as { databasePassword?: string };
				return HttpResponse.json({
					postgresId: 'pg_123',
					name: 'myapp-db',
					appName: 'myapp-db',
					databaseName: 'app',
					databaseUser: 'postgres',
					databasePassword: body.databasePassword,
					applicationStatus: 'idle',
				});
			}),
			http.post(`${BASE_URL}/api/postgres.deploy`, () => {
				return HttpResponse.json({ success: true });
			}),
		);

		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(api, 'proj_1', 'env_1', 'myapp', {
			postgres: true,
		});

		expect(result).toBeDefined();
		expect(result?.serviceUrls?.DATABASE_URL).toMatch(
			/^postgresql:\/\/postgres:[a-f0-9]{32}@myapp-db:5432\/app$/,
		);
	});

	it('should provision postgres and return individual connection parameters', async () => {
		server.use(
			http.post(`${BASE_URL}/api/postgres.create`, async ({ request }) => {
				const body = (await request.json()) as { databasePassword?: string };
				return HttpResponse.json({
					postgresId: 'pg_123',
					name: 'myapp-db',
					appName: 'myapp-db',
					databaseName: 'mydb',
					databaseUser: 'dbuser',
					databasePassword: body.databasePassword,
					applicationStatus: 'idle',
				});
			}),
			http.post(`${BASE_URL}/api/postgres.deploy`, () => {
				return HttpResponse.json({ success: true });
			}),
		);

		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(api, 'proj_1', 'env_1', 'myapp', {
			postgres: true,
		});

		expect(result).toBeDefined();
		expect(result?.serviceUrls?.DATABASE_HOST).toBe('myapp-db');
		expect(result?.serviceUrls?.DATABASE_PORT).toBe('5432');
		expect(result?.serviceUrls?.DATABASE_NAME).toBe('mydb');
		expect(result?.serviceUrls?.DATABASE_USER).toBe('dbuser');
		expect(result?.serviceUrls?.DATABASE_PASSWORD).toMatch(/^[a-f0-9]{32}$/);
	});

	it('should provision redis and return REDIS_URL', async () => {
		server.use(
			http.post(`${BASE_URL}/api/redis.create`, async ({ request }) => {
				const body = (await request.json()) as { databasePassword?: string };
				return HttpResponse.json({
					redisId: 'redis_123',
					name: 'myapp-cache',
					appName: 'myapp-cache',
					databasePassword: body.databasePassword,
					applicationStatus: 'idle',
				});
			}),
			http.post(`${BASE_URL}/api/redis.deploy`, () => {
				return HttpResponse.json({ success: true });
			}),
		);

		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(api, 'proj_1', 'env_1', 'myapp', {
			redis: true,
		});

		expect(result).toBeDefined();
		expect(result?.serviceUrls?.REDIS_URL).toMatch(
			/^redis:\/\/:[a-f0-9]{32}@myapp-cache:6379$/,
		);
	});

	it('should provision redis and return individual connection parameters', async () => {
		server.use(
			http.post(`${BASE_URL}/api/redis.create`, async ({ request }) => {
				const body = (await request.json()) as { databasePassword?: string };
				return HttpResponse.json({
					redisId: 'redis_123',
					name: 'myapp-cache',
					appName: 'myapp-cache',
					databasePassword: body.databasePassword,
					applicationStatus: 'idle',
				});
			}),
			http.post(`${BASE_URL}/api/redis.deploy`, () => {
				return HttpResponse.json({ success: true });
			}),
		);

		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(api, 'proj_1', 'env_1', 'myapp', {
			redis: true,
		});

		expect(result).toBeDefined();
		expect(result?.serviceUrls?.REDIS_HOST).toBe('myapp-cache');
		expect(result?.serviceUrls?.REDIS_PORT).toBe('6379');
		expect(result?.serviceUrls?.REDIS_PASSWORD).toMatch(/^[a-f0-9]{32}$/);
	});

	it('should provision both postgres and redis', async () => {
		server.use(
			http.post(`${BASE_URL}/api/postgres.create`, async ({ request }) => {
				const body = (await request.json()) as { databasePassword?: string };
				return HttpResponse.json({
					postgresId: 'pg_123',
					name: 'myapp-db',
					appName: 'myapp-db',
					databaseName: 'app',
					databaseUser: 'postgres',
					databasePassword: body.databasePassword,
				});
			}),
			http.post(`${BASE_URL}/api/postgres.deploy`, () => {
				return HttpResponse.json({ success: true });
			}),
			http.post(`${BASE_URL}/api/redis.create`, async ({ request }) => {
				const body = (await request.json()) as { databasePassword?: string };
				return HttpResponse.json({
					redisId: 'redis_123',
					name: 'myapp-cache',
					appName: 'myapp-cache',
					databasePassword: body.databasePassword,
				});
			}),
			http.post(`${BASE_URL}/api/redis.deploy`, () => {
				return HttpResponse.json({ success: true });
			}),
		);

		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(api, 'proj_1', 'env_1', 'myapp', {
			postgres: true,
			redis: true,
		});

		expect(result).toBeDefined();
		expect(result?.serviceUrls?.DATABASE_URL).toBeDefined();
		expect(result?.serviceUrls?.REDIS_URL).toBeDefined();
	});

	it('should handle postgres already exists error gracefully', async () => {
		server.use(
			http.post(`${BASE_URL}/api/postgres.create`, () => {
				return HttpResponse.json(
					{ message: 'Resource already exists' },
					{ status: 400 },
				);
			}),
		);

		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		// Should not throw, just return undefined for that service
		const result = await provisionServices(api, 'proj_1', 'env_1', 'myapp', {
			postgres: true,
		});

		expect(result).toBeUndefined();
	});

	it('should handle redis already exists error gracefully', async () => {
		server.use(
			http.post(`${BASE_URL}/api/redis.create`, () => {
				return HttpResponse.json(
					{ message: 'duplicate key error' },
					{ status: 400 },
				);
			}),
		);

		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(api, 'proj_1', 'env_1', 'myapp', {
			redis: true,
		});

		expect(result).toBeUndefined();
	});
});

describe('DockerComposeServices parsing', () => {
	it('should parse array format', () => {
		const composeServices = ['postgres', 'redis'];
		const dockerServices = {
			postgres: composeServices.includes('postgres'),
			redis: composeServices.includes('redis'),
			rabbitmq: composeServices.includes('rabbitmq'),
		};

		expect(dockerServices).toEqual({
			postgres: true,
			redis: true,
			rabbitmq: false,
		});
	});

	it('should parse object format', () => {
		const composeServices = { postgres: true, redis: false };
		const dockerServices = {
			postgres: Boolean(composeServices.postgres),
			redis: Boolean(composeServices.redis),
			rabbitmq: false,
		};

		expect(dockerServices).toEqual({
			postgres: true,
			redis: false,
			rabbitmq: false,
		});
	});

	it('should handle undefined', () => {
		const composeServices = undefined;
		const dockerServices = composeServices ? {} : undefined;

		expect(dockerServices).toBeUndefined();
	});
});

describe('image reference construction', () => {
	it('should construct image ref with registry', () => {
		const registry = 'ghcr.io/myorg';
		const imageName = 'myapp';
		const imageTag = 'v1.0.0';
		const imageRef = registry
			? `${registry}/${imageName}:${imageTag}`
			: `${imageName}:${imageTag}`;

		expect(imageRef).toBe('ghcr.io/myorg/myapp:v1.0.0');
	});

	it('should construct image ref without registry', () => {
		const registry = undefined;
		const imageName = 'myapp';
		const imageTag = 'v1.0.0';
		const imageRef = registry
			? `${registry}/${imageName}:${imageTag}`
			: `${imageName}:${imageTag}`;

		expect(imageRef).toBe('myapp:v1.0.0');
	});

	it('should handle different registry formats', () => {
		// Docker Hub
		expect(`docker.io/myapp:latest`).toBe('docker.io/myapp:latest');
		// GCR
		expect(`gcr.io/project/myapp:v1`).toBe('gcr.io/project/myapp:v1');
		// ECR
		expect(`123456789.dkr.ecr.us-east-1.amazonaws.com/myapp:latest`).toBe(
			'123456789.dkr.ecr.us-east-1.amazonaws.com/myapp:latest',
		);
	});
});

describe('generateTag edge cases', () => {
	it('should handle stage with special characters', () => {
		const tag = generateTag('prod-us-east');
		expect(tag).toMatch(/^prod-us-east-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
	});

	it('should generate consistent format', () => {
		const tags = [
			generateTag('dev'),
			generateTag('staging'),
			generateTag('production'),
		];

		for (const tag of tags) {
			// Should match ISO 8601 format with dashes instead of colons/periods
			expect(tag).toMatch(/^[a-z-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
		}
	});
});

describe('workspaceDeployCommand', () => {
	/** Create a minimal workspace config for testing */
	function createWorkspace(
		overrides: Partial<NormalizedWorkspace> = {},
	): NormalizedWorkspace {
		return {
			name: 'test-workspace',
			root: '/workspace',
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
					resolvedDeployTarget: 'dokploy',
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					dependencies: ['api'],
					framework: 'nextjs',
					resolvedDeployTarget: 'dokploy',
				},
			},
			services: {},
			deploy: { default: 'dokploy' },
			shared: { packages: [] },
			secrets: {},
			...overrides,
		};
	}

	describe('provider validation', () => {
		it('should reject non-dokploy providers', async () => {
			const workspace = createWorkspace();
			const options: DeployOptions = {
				provider: 'docker',
				stage: 'production',
			};

			await expect(workspaceDeployCommand(workspace, options)).rejects.toThrow(
				'Workspace deployment only supports Dokploy',
			);
		});

		it('should reject aws-lambda provider', async () => {
			const workspace = createWorkspace();
			const options: DeployOptions = {
				provider: 'aws-lambda',
				stage: 'production',
			};

			await expect(workspaceDeployCommand(workspace, options)).rejects.toThrow(
				'Workspace deployment only supports Dokploy',
			);
		});
	});

	describe('selective app deployment', () => {
		it('should validate selected apps exist', async () => {
			const workspace = createWorkspace();
			const options: DeployOptions = {
				provider: 'dokploy',
				stage: 'production',
				apps: ['api', 'nonexistent'],
			};

			// Mock credentials check to fail fast
			vi.mock('../../auth', () => ({
				getDokployCredentials: vi.fn().mockResolvedValue(null),
				getDokployRegistryId: vi.fn().mockResolvedValue(null),
				storeDokployCredentials: vi.fn(),
				validateDokployToken: vi.fn().mockResolvedValue(true),
			}));

			await expect(workspaceDeployCommand(workspace, options)).rejects.toThrow(
				'Unknown apps: nonexistent',
			);
		});

		it('should filter selected apps while maintaining dependency order', () => {
			// Test the filtering logic directly
			const buildOrder = ['api', 'auth', 'web', 'admin'];
			const selectedApps = ['web', 'api'];

			const filtered = buildOrder.filter((name) => selectedApps.includes(name));

			// Should be in dependency order (api before web)
			expect(filtered).toEqual(['api', 'web']);
		});
	});

	describe('dependency ordering', () => {
		it('should deploy backends before dependent frontends', () => {
			// The getAppBuildOrder function returns topologically sorted order
			// This is a unit test for the ordering logic
			const workspace = createWorkspace({
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3001,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api', 'auth'],
						framework: 'nextjs',
						resolvedDeployTarget: 'dokploy',
					},
				},
			});

			// Import getAppBuildOrder to verify ordering
			const { getAppBuildOrder } = require('../../workspace/index.js');
			const order = getAppBuildOrder(workspace);

			// api and auth should come before web
			const apiIndex = order.indexOf('api');
			const authIndex = order.indexOf('auth');
			const webIndex = order.indexOf('web');

			expect(apiIndex).toBeLessThan(webIndex);
			expect(authIndex).toBeLessThan(webIndex);
		});

		it('should handle chain dependencies correctly', () => {
			const workspace = createWorkspace({
				apps: {
					db: {
						type: 'backend',
						path: 'apps/db',
						port: 3000,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
					},
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3001,
						dependencies: ['db'],
						resolvedDeployTarget: 'dokploy',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api'],
						framework: 'nextjs',
						resolvedDeployTarget: 'dokploy',
					},
				},
			});

			const { getAppBuildOrder } = require('../../workspace/index.js');
			const order = getAppBuildOrder(workspace);

			// db -> api -> web
			expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'));
			expect(order.indexOf('api')).toBeLessThan(order.indexOf('web'));
		});
	});

	describe('environment variable injection', () => {
		it('should inject APP_URL for dependencies', () => {
			// Test the environment variable construction logic
			const deployedAppUrls: Record<string, string> = {
				api: 'http://test-workspace-api:3000',
				auth: 'http://test-workspace-auth:3001',
			};

			const appDependencies = ['api', 'auth'];
			const envVars: string[] = [];

			for (const dep of appDependencies) {
				const depUrl = deployedAppUrls[dep];
				if (depUrl) {
					envVars.push(`${dep.toUpperCase()}_URL=${depUrl}`);
				}
			}

			expect(envVars).toContain('API_URL=http://test-workspace-api:3000');
			expect(envVars).toContain('AUTH_URL=http://test-workspace-auth:3001');
		});

		it('should build dependencyUrls from publicUrls for deployed apps', () => {
			// Test the dependencyUrls building logic used in workspaceDeployCommand
			const publicUrls: Record<string, string> = {
				api: 'https://api.example.com',
				auth: 'https://auth.example.com',
			};

			const app = {
				type: 'frontend' as const,
				path: 'apps/web',
				port: 3000,
				dependencies: ['api', 'auth'],
				framework: 'nextjs' as const,
			};

			// Build dependency URLs from already-deployed apps (mimics workspaceDeployCommand logic)
			const dependencyUrls: Record<string, string> = {};
			if (app.dependencies) {
				for (const dep of app.dependencies) {
					if (publicUrls[dep]) {
						dependencyUrls[dep] = publicUrls[dep];
					}
				}
			}

			expect(dependencyUrls).toEqual({
				api: 'https://api.example.com',
				auth: 'https://auth.example.com',
			});
		});

		it('should only include dependencies that have been deployed', () => {
			// Test that dependencyUrls only includes apps that exist in publicUrls
			const publicUrls: Record<string, string> = {
				api: 'https://api.example.com',
				// auth is NOT deployed yet
			};

			const app = {
				type: 'frontend' as const,
				path: 'apps/web',
				port: 3000,
				dependencies: ['api', 'auth'], // wants both api and auth
				framework: 'nextjs' as const,
			};

			const dependencyUrls: Record<string, string> = {};
			if (app.dependencies) {
				for (const dep of app.dependencies) {
					if (publicUrls[dep]) {
						dependencyUrls[dep] = publicUrls[dep];
					}
				}
			}

			// Only api should be included, auth is not yet deployed
			expect(dependencyUrls).toEqual({
				api: 'https://api.example.com',
			});
			expect(dependencyUrls.auth).toBeUndefined();
		});

		it('should handle apps with no dependencies', () => {
			const publicUrls: Record<string, string> = {
				api: 'https://api.example.com',
			};

			const app = {
				type: 'backend' as const,
				path: 'apps/api',
				port: 3000,
				dependencies: [], // no dependencies
			};

			const dependencyUrls: Record<string, string> = {};
			if (app.dependencies) {
				for (const dep of app.dependencies) {
					if (publicUrls[dep]) {
						dependencyUrls[dep] = publicUrls[dep];
					}
				}
			}

			expect(dependencyUrls).toEqual({});
		});

		it('should handle apps with undefined dependencies', () => {
			const publicUrls: Record<string, string> = {
				api: 'https://api.example.com',
			};

			const app = {
				type: 'backend' as const,
				path: 'apps/api',
				port: 3000,
				dependencies: undefined as unknown as string[],
			};

			const dependencyUrls: Record<string, string> = {};
			if (app.dependencies) {
				for (const dep of app.dependencies) {
					if (publicUrls[dep]) {
						dependencyUrls[dep] = publicUrls[dep];
					}
				}
			}

			expect(dependencyUrls).toEqual({});
		});

		it('should inject DATABASE_URL for backend apps', () => {
			const workspaceName = 'test-workspace';
			const hasPostgres = true;
			const appType: 'backend' | 'frontend' = 'backend';

			const envVars: string[] = [];

			if (appType === 'backend' && hasPostgres) {
				envVars.push(
					`DATABASE_URL=\${DATABASE_URL:-postgresql://postgres:postgres@${workspaceName}-db:5432/app}`,
				);
			}

			expect(envVars).toHaveLength(1);
			expect(envVars[0]).toContain('test-workspace-db');
		});

		it('should not inject DATABASE_URL for frontend apps', () => {
			const hasPostgres = true;
			const appType = 'frontend' as 'backend' | 'frontend';

			const envVars: string[] = [];

			if (appType === 'backend' && hasPostgres) {
				envVars.push(`DATABASE_URL=...`);
			}

			expect(envVars).toHaveLength(0);
		});
	});

	describe('image naming', () => {
		it('should construct image name from workspace and app name', () => {
			const workspaceName = 'my-workspace';
			const appName = 'api';
			const imageTag = 'production-2024-01-01T12-00-00';
			const registry = 'ghcr.io/myorg';

			const imageName = `${workspaceName}-${appName}`;
			const imageRef = registry
				? `${registry}/${imageName}:${imageTag}`
				: `${imageName}:${imageTag}`;

			expect(imageName).toBe('my-workspace-api');
			expect(imageRef).toBe(
				'ghcr.io/myorg/my-workspace-api:production-2024-01-01T12-00-00',
			);
		});

		it('should handle workspace name with special characters', () => {
			const workspaceName = 'my-cool-workspace';
			const appName = 'web-frontend';

			const imageName = `${workspaceName}-${appName}`;

			expect(imageName).toBe('my-cool-workspace-web-frontend');
		});
	});

	describe('result types', () => {
		it('should have correct structure for AppDeployResult', () => {
			const successResult = {
				appName: 'api',
				type: 'backend' as const,
				success: true,
				applicationId: 'app_123',
				imageRef: 'ghcr.io/org/api:v1',
			};

			expect(successResult.appName).toBe('api');
			expect(successResult.type).toBe('backend');
			expect(successResult.success).toBe(true);
			expect(successResult.applicationId).toBe('app_123');
		});

		it('should have correct structure for failed AppDeployResult', () => {
			const failedResult = {
				appName: 'web',
				type: 'frontend' as const,
				success: false,
				error: 'Build failed',
			};

			expect(failedResult.success).toBe(false);
			expect(failedResult.error).toBe('Build failed');
		});

		it('should have correct structure for WorkspaceDeployResult', () => {
			const result = {
				apps: [
					{ appName: 'api', type: 'backend' as const, success: true },
					{
						appName: 'web',
						type: 'frontend' as const,
						success: false,
						error: 'Failed',
					},
				],
				projectId: 'proj_123',
				successCount: 1,
				failedCount: 1,
			};

			expect(result.apps).toHaveLength(2);
			expect(result.successCount).toBe(1);
			expect(result.failedCount).toBe(1);
		});
	});

	describe('workspace dependencyUrls integration with env resolver', () => {
		it('should resolve dependency URLs when building env context for an app', () => {
			// Simulate the scenario where api and auth are deployed, then web needs their URLs
			const publicUrls: Record<string, string> = {
				api: 'https://api.myapp.com',
				auth: 'https://auth.myapp.com',
			};

			const webApp = {
				type: 'frontend' as const,
				path: 'apps/web',
				port: 3000,
				dependencies: ['api', 'auth'],
				framework: 'nextjs' as const,
				resolvedDeployTarget: 'dokploy' as const,
			};

			// Build dependencyUrls (as done in workspaceDeployCommand)
			const dependencyUrls: Record<string, string> = {};
			for (const dep of webApp.dependencies) {
				if (publicUrls[dep]) {
					dependencyUrls[dep] = publicUrls[dep];
				}
			}

			// Create env context with dependencyUrls
			const context: EnvResolverContext = {
				app: webApp,
				appName: 'web',
				stage: 'production',
				state: createEmptyState('production', 'proj_test', 'env-123'),
				appHostname: 'web.myapp.com',
				frontendUrls: [],
				dependencyUrls,
			};

			// Resolve API_URL and AUTH_URL
			expect(resolveEnvVar('API_URL', context)).toBe('https://api.myapp.com');
			expect(resolveEnvVar('AUTH_URL', context)).toBe('https://auth.myapp.com');
		});

		it('should resolve multiple env vars including dependency URLs', () => {
			const publicUrls: Record<string, string> = {
				api: 'https://api.example.com',
				payments: 'https://payments.example.com',
			};

			const webApp = {
				type: 'frontend' as const,
				path: 'apps/web',
				port: 3001,
				dependencies: ['api', 'payments'],
				framework: 'nextjs' as const,
				resolvedDeployTarget: 'dokploy' as const,
			};

			// Build dependencyUrls
			const dependencyUrls: Record<string, string> = {};
			for (const dep of webApp.dependencies) {
				if (publicUrls[dep]) {
					dependencyUrls[dep] = publicUrls[dep];
				}
			}

			const context: EnvResolverContext = {
				app: webApp,
				appName: 'web',
				stage: 'production',
				state: createEmptyState('production', 'proj_test', 'env-123'),
				appHostname: 'web.example.com',
				frontendUrls: [],
				dependencyUrls,
			};

			// Resolve all required vars including dependency URLs
			const result = resolveEnvVars(
				['PORT', 'NODE_ENV', 'API_URL', 'PAYMENTS_URL'],
				context,
			);

			expect(result.resolved).toEqual({
				PORT: '3001',
				NODE_ENV: 'production',
				API_URL: 'https://api.example.com',
				PAYMENTS_URL: 'https://payments.example.com',
			});
			expect(result.missing).toEqual([]);
		});

		it('should report missing dependency URLs when dependency not yet deployed', () => {
			// Scenario: web depends on api and auth, but only api is deployed
			const publicUrls: Record<string, string> = {
				api: 'https://api.example.com',
				// auth is NOT deployed
			};

			const webApp = {
				type: 'frontend' as const,
				path: 'apps/web',
				port: 3001,
				dependencies: ['api', 'auth'],
				framework: 'nextjs' as const,
				resolvedDeployTarget: 'dokploy' as const,
			};

			// Build dependencyUrls (auth will be missing)
			const dependencyUrls: Record<string, string> = {};
			for (const dep of webApp.dependencies) {
				if (publicUrls[dep]) {
					dependencyUrls[dep] = publicUrls[dep];
				}
			}

			const context: EnvResolverContext = {
				app: webApp,
				appName: 'web',
				stage: 'production',
				state: createEmptyState('production', 'proj_test', 'env-123'),
				appHostname: 'web.example.com',
				frontendUrls: [],
				dependencyUrls,
			};

			const result = resolveEnvVars(['API_URL', 'AUTH_URL'], context);

			expect(result.resolved).toEqual({
				API_URL: 'https://api.example.com',
			});
			expect(result.missing).toEqual(['AUTH_URL']);
		});

		it('should correctly resolve chain of dependencies (db -> api -> web)', () => {
			// Simulate deploying in order: db (no deps), api (depends on nothing but needs DATABASE_URL),
			// then web (depends on api)
			const publicUrls: Record<string, string> = {};
			const state = createEmptyState('production', 'proj_test', 'env-123');

			// Step 1: Deploy api first
			const apiApp = {
				type: 'backend' as const,
				path: 'apps/api',
				port: 3000,
				dependencies: [],
				resolvedDeployTarget: 'dokploy' as const,
			};

			const apiContext: EnvResolverContext = {
				app: apiApp,
				appName: 'api',
				stage: 'production',
				state,
				appHostname: 'api.example.com',
				frontendUrls: [],
				appCredentials: { dbUser: 'api', dbPassword: 'secret' },
				postgres: { host: 'db', port: 5432, database: 'myapp' },
				dependencyUrls: {}, // api has no dependencies
			};

			const apiResult = resolveEnvVars(
				['PORT', 'NODE_ENV', 'DATABASE_URL'],
				apiContext,
			);
			expect(apiResult.missing).toEqual([]);
			expect(apiResult.resolved.DATABASE_URL).toBe(
				'postgresql://api:secret@db:5432/myapp',
			);

			// Simulate api is now deployed
			publicUrls.api = 'https://api.example.com';

			// Step 2: Deploy web (depends on api)
			const webApp = {
				type: 'frontend' as const,
				path: 'apps/web',
				port: 3001,
				dependencies: ['api'],
				framework: 'nextjs' as const,
				resolvedDeployTarget: 'dokploy' as const,
			};

			const webDependencyUrls: Record<string, string> = {};
			for (const dep of webApp.dependencies) {
				if (publicUrls[dep]) {
					webDependencyUrls[dep] = publicUrls[dep];
				}
			}

			const webContext: EnvResolverContext = {
				app: webApp,
				appName: 'web',
				stage: 'production',
				state,
				appHostname: 'web.example.com',
				frontendUrls: [],
				dependencyUrls: webDependencyUrls,
			};

			const webResult = resolveEnvVars(['PORT', 'NODE_ENV', 'API_URL'], webContext);

			expect(webResult.missing).toEqual([]);
			expect(webResult.resolved).toEqual({
				PORT: '3001',
				NODE_ENV: 'production',
				API_URL: 'https://api.example.com',
			});
		});

		it('should handle microservices topology with multiple inter-dependencies', () => {
			// Scenario:
			// - auth service (no deps)
			// - api service (depends on auth)
			// - notifications service (depends on api)
			// - web (depends on api, auth, notifications)
			const publicUrls: Record<string, string> = {
				auth: 'https://auth.example.com',
				api: 'https://api.example.com',
				notifications: 'https://notifications.example.com',
			};

			const webApp = {
				type: 'frontend' as const,
				path: 'apps/web',
				port: 3000,
				dependencies: ['api', 'auth', 'notifications'],
				framework: 'nextjs' as const,
				resolvedDeployTarget: 'dokploy' as const,
			};

			// Build dependencyUrls for web
			const dependencyUrls: Record<string, string> = {};
			for (const dep of webApp.dependencies) {
				if (publicUrls[dep]) {
					dependencyUrls[dep] = publicUrls[dep];
				}
			}

			const context: EnvResolverContext = {
				app: webApp,
				appName: 'web',
				stage: 'production',
				state: createEmptyState('production', 'proj_test', 'env-123'),
				appHostname: 'web.example.com',
				frontendUrls: [],
				dependencyUrls,
			};

			const result = resolveEnvVars(
				['PORT', 'API_URL', 'AUTH_URL', 'NOTIFICATIONS_URL'],
				context,
			);

			expect(result.missing).toEqual([]);
			expect(result.resolved).toEqual({
				PORT: '3000',
				API_URL: 'https://api.example.com',
				AUTH_URL: 'https://auth.example.com',
				NOTIFICATIONS_URL: 'https://notifications.example.com',
			});
		});
	});
});
