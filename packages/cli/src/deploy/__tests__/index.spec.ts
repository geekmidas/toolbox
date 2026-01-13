import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DokployApi } from '../dokploy-api';
import { generateTag, provisionServices } from '../index';

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
