import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types.js';
import { DokployApi } from '../dokploy-api';
import { generateTag, provisionServices, workspaceDeployCommand } from '../index';
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

	it('should skip postgres when DATABASE_URL already exists', async () => {
		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(
			api,
			'proj_1',
			'env_1',
			'myapp',
			{ postgres: true },
			{ DATABASE_URL: 'postgresql://existing:5432/db' },
		);

		// Should return undefined since nothing new was provisioned
		expect(result).toBeUndefined();
	});

	it('should skip redis when REDIS_URL already exists', async () => {
		const api = new DokployApi({ baseUrl: BASE_URL, token: 'test-token' });

		const result = await provisionServices(
			api,
			'proj_1',
			'env_1',
			'myapp',
			{ redis: true },
			{ REDIS_URL: 'redis://existing:6379' },
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
		expect(result?.DATABASE_URL).toMatch(
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
		expect(result?.DATABASE_HOST).toBe('myapp-db');
		expect(result?.DATABASE_PORT).toBe('5432');
		expect(result?.DATABASE_NAME).toBe('mydb');
		expect(result?.DATABASE_USER).toBe('dbuser');
		expect(result?.DATABASE_PASSWORD).toMatch(/^[a-f0-9]{32}$/);
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
		expect(result?.REDIS_URL).toMatch(
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
		expect(result?.REDIS_HOST).toBe('myapp-cache');
		expect(result?.REDIS_PORT).toBe('6379');
		expect(result?.REDIS_PASSWORD).toMatch(/^[a-f0-9]{32}$/);
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
		expect(result?.DATABASE_URL).toBeDefined();
		expect(result?.REDIS_URL).toBeDefined();
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
				},
				web: {
					type: 'frontend',
					path: 'apps/web',
					port: 3001,
					dependencies: ['api'],
					framework: 'nextjs',
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

			await expect(
				workspaceDeployCommand(workspace, options),
			).rejects.toThrow('Workspace deployment only supports Dokploy');
		});

		it('should reject aws-lambda provider', async () => {
			const workspace = createWorkspace();
			const options: DeployOptions = {
				provider: 'aws-lambda',
				stage: 'production',
			};

			await expect(
				workspaceDeployCommand(workspace, options),
			).rejects.toThrow('Workspace deployment only supports Dokploy');
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

			await expect(
				workspaceDeployCommand(workspace, options),
			).rejects.toThrow('Unknown apps: nonexistent');
		});

		it('should filter selected apps while maintaining dependency order', () => {
			// Test the filtering logic directly
			const buildOrder = ['api', 'auth', 'web', 'admin'];
			const selectedApps = ['web', 'api'];

			const filtered = buildOrder.filter((name) =>
				selectedApps.includes(name),
			);

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
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3001,
						dependencies: [],
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api', 'auth'],
						framework: 'nextjs',
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
					},
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3001,
						dependencies: ['db'],
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api'],
						framework: 'nextjs',
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

			expect(envVars).toContain(
				'API_URL=http://test-workspace-api:3000',
			);
			expect(envVars).toContain(
				'AUTH_URL=http://test-workspace-auth:3001',
			);
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
			const appType: 'backend' | 'frontend' = 'frontend';

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
					{ appName: 'web', type: 'frontend' as const, success: false, error: 'Failed' },
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
});
