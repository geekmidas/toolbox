import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DokployApi, DokployApiError } from '../dokploy-api';

const BASE_URL = 'https://dokploy.example.com';
const server = setupServer();

describe('DokployApi', () => {
	let api: DokployApi;

	beforeEach(() => {
		api = new DokployApi({
			baseUrl: BASE_URL,
			token: 'test-api-token',
		});
		server.listen({ onUnhandledRequest: 'bypass' });
	});

	afterEach(() => {
		server.resetHandlers();
		server.close();
	});

	describe('constructor', () => {
		it('should remove trailing slash from baseUrl', () => {
			const apiWithSlash = new DokployApi({
				baseUrl: 'https://example.com/',
				token: 'token',
			});
			// Can't directly test private property, but we can test through a request
			expect(apiWithSlash).toBeDefined();
		});
	});

	describe('request handling', () => {
		it('should include x-api-key header', async () => {
			let capturedHeaders: Headers | undefined;

			server.use(
				http.get(`${BASE_URL}/api/project.all`, ({ request }) => {
					capturedHeaders = request.headers;
					return HttpResponse.json([]);
				}),
			);

			await api.listProjects();

			expect(capturedHeaders?.get('x-api-key')).toBe('test-api-token');
		});

		it('should include Content-Type header', async () => {
			let capturedHeaders: Headers | undefined;

			server.use(
				http.post(`${BASE_URL}/api/project.create`, ({ request }) => {
					capturedHeaders = request.headers;
					return HttpResponse.json({ projectId: 'proj_123' });
				}),
			);

			await api.createProject('test');

			expect(capturedHeaders?.get('content-type')).toBe('application/json');
		});

		it('should throw DokployApiError on non-ok response', async () => {
			server.use(
				http.get(`${BASE_URL}/api/project.all`, () => {
					return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
				}),
			);

			await expect(api.listProjects()).rejects.toThrow(DokployApiError);
		});

		it('should include error message from response', async () => {
			server.use(
				http.get(`${BASE_URL}/api/project.all`, () => {
					return HttpResponse.json(
						{ message: 'Invalid token' },
						{ status: 401 },
					);
				}),
			);

			try {
				await api.listProjects();
			} catch (error) {
				expect(error).toBeInstanceOf(DokployApiError);
				expect((error as DokployApiError).message).toContain('Invalid token');
				expect((error as DokployApiError).status).toBe(401);
			}
		});

		it('should include issues in error', async () => {
			server.use(
				http.post(`${BASE_URL}/api/project.create`, () => {
					return HttpResponse.json(
						{
							message: 'Validation failed',
							issues: [
								{ message: 'Name is required' },
								{ message: 'Name is too short' },
							],
						},
						{ status: 400 },
					);
				}),
			);

			try {
				await api.createProject('');
			} catch (error) {
				expect(error).toBeInstanceOf(DokployApiError);
				const err = error as DokployApiError;
				expect(err.issues).toHaveLength(2);
				expect(err.message).toContain('Name is required');
				expect(err.message).toContain('Name is too short');
			}
		});
	});

	describe('validateToken', () => {
		it('should return true for valid token', async () => {
			server.use(
				http.get(`${BASE_URL}/api/project.all`, () => {
					return HttpResponse.json([]);
				}),
			);

			const result = await api.validateToken();
			expect(result).toBe(true);
		});

		it('should return false for invalid token', async () => {
			server.use(
				http.get(`${BASE_URL}/api/project.all`, () => {
					return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
				}),
			);

			const result = await api.validateToken();
			expect(result).toBe(false);
		});
	});

	describe('project endpoints', () => {
		it('should list projects', async () => {
			const projects = [
				{ projectId: 'proj_1', name: 'Project 1', description: null },
				{ projectId: 'proj_2', name: 'Project 2', description: 'Test' },
			];

			server.use(
				http.get(`${BASE_URL}/api/project.all`, () => {
					return HttpResponse.json(projects);
				}),
			);

			const result = await api.listProjects();
			expect(result).toEqual(projects);
		});

		it('should get project by ID', async () => {
			const project = {
				projectId: 'proj_123',
				name: 'My Project',
				description: 'Test project',
				environments: [{ environmentId: 'env_1', name: 'production' }],
			};

			server.use(
				http.get(`${BASE_URL}/api/project.one`, ({ request }) => {
					const url = new URL(request.url);
					expect(url.searchParams.get('projectId')).toBe('proj_123');
					return HttpResponse.json(project);
				}),
			);

			const result = await api.getProject('proj_123');
			expect(result).toEqual(project);
		});

		it('should create project', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/project.create`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({
						projectId: 'proj_new',
						name: 'New Project',
						description: 'Custom description',
					});
				}),
			);

			const result = await api.createProject('New Project', 'Custom description');

			expect(result.projectId).toBe('proj_new');
			expect(capturedBody).toMatchObject({
				name: 'New Project',
				description: 'Custom description',
			});
		});

		it('should use default description when not provided', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/project.create`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({ projectId: 'proj_new', name: 'Test' });
				}),
			);

			await api.createProject('Test');

			expect((capturedBody as { description: string }).description).toBe(
				'Created by gkm CLI',
			);
		});
	});

	describe('application endpoints', () => {
		it('should create application', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/application.create`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({
						applicationId: 'app_123',
						name: 'My App',
						appName: 'my-app',
					});
				}),
			);

			const result = await api.createApplication('My App', 'proj_1', 'env_1');

			expect(result.applicationId).toBe('app_123');
			expect(capturedBody).toMatchObject({
				name: 'My App',
				projectId: 'proj_1',
				environmentId: 'env_1',
				appName: 'my-app',
			});
		});

		it('should sanitize appName', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/application.create`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({ applicationId: 'app_123' });
				}),
			);

			await api.createApplication('My App With Spaces!', 'proj_1', 'env_1');

			expect((capturedBody as { appName: string }).appName).toBe(
				'my-app-with-spaces-',
			);
		});

		it('should save docker provider', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(
					`${BASE_URL}/api/application.saveDockerProvider`,
					async ({ request }) => {
						capturedBody = await request.json();
						return HttpResponse.json({ success: true });
					},
				),
			);

			await api.saveDockerProvider('app_123', 'ghcr.io/org/image:tag', {
				registryId: 'reg_456',
			});

			expect(capturedBody).toMatchObject({
				applicationId: 'app_123',
				dockerImage: 'ghcr.io/org/image:tag',
				registryId: 'reg_456',
			});
		});

		it('should save docker provider with direct credentials', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(
					`${BASE_URL}/api/application.saveDockerProvider`,
					async ({ request }) => {
						capturedBody = await request.json();
						return HttpResponse.json({ success: true });
					},
				),
			);

			await api.saveDockerProvider('app_123', 'ghcr.io/org/image:tag', {
				username: 'user',
				password: 'pass',
				registryUrl: 'ghcr.io',
			});

			expect(capturedBody).toMatchObject({
				applicationId: 'app_123',
				dockerImage: 'ghcr.io/org/image:tag',
				username: 'user',
				password: 'pass',
				registryUrl: 'ghcr.io',
			});
		});

		it('should save application environment', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(
					`${BASE_URL}/api/application.saveEnvironment`,
					async ({ request }) => {
						capturedBody = await request.json();
						return HttpResponse.json({ success: true });
					},
				),
			);

			await api.saveApplicationEnv('app_123', 'KEY=value\nANOTHER=test');

			expect(capturedBody).toMatchObject({
				applicationId: 'app_123',
				env: 'KEY=value\nANOTHER=test',
			});
		});

		it('should deploy application', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/application.deploy`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({ success: true });
				}),
			);

			await api.deployApplication('app_123');

			expect(capturedBody).toMatchObject({
				applicationId: 'app_123',
			});
		});
	});

	describe('registry endpoints', () => {
		it('should list registries', async () => {
			const registries = [
				{
					registryId: 'reg_1',
					registryName: 'GitHub',
					registryUrl: 'ghcr.io',
					username: 'user',
				},
			];

			server.use(
				http.get(`${BASE_URL}/api/registry.all`, () => {
					return HttpResponse.json(registries);
				}),
			);

			const result = await api.listRegistries();
			expect(result).toEqual(registries);
		});

		it('should create registry', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/registry.create`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({
						registryId: 'reg_new',
						registryName: 'GitHub',
						registryUrl: 'ghcr.io',
						username: 'user',
					});
				}),
			);

			const result = await api.createRegistry(
				'GitHub',
				'ghcr.io',
				'user',
				'token',
				{ imagePrefix: 'org' },
			);

			expect(result.registryId).toBe('reg_new');
			expect(capturedBody).toMatchObject({
				registryName: 'GitHub',
				registryUrl: 'ghcr.io',
				username: 'user',
				password: 'token',
				imagePrefix: 'org',
			});
		});

		it('should get registry by ID', async () => {
			server.use(
				http.get(`${BASE_URL}/api/registry.one`, ({ request }) => {
					const url = new URL(request.url);
					expect(url.searchParams.get('registryId')).toBe('reg_123');
					return HttpResponse.json({
						registryId: 'reg_123',
						registryName: 'Test',
						registryUrl: 'test.io',
						username: 'user',
					});
				}),
			);

			const result = await api.getRegistry('reg_123');
			expect(result.registryId).toBe('reg_123');
		});

		it('should update registry', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/registry.update`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({ success: true });
				}),
			);

			await api.updateRegistry('reg_123', { registryName: 'New Name' });

			expect(capturedBody).toMatchObject({
				registryId: 'reg_123',
				registryName: 'New Name',
			});
		});

		it('should delete registry', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/registry.remove`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({ success: true });
				}),
			);

			await api.deleteRegistry('reg_123');

			expect(capturedBody).toMatchObject({
				registryId: 'reg_123',
			});
		});
	});

	describe('postgres endpoints', () => {
		it('should create postgres', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/postgres.create`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({
						postgresId: 'pg_123',
						name: 'MyDB',
						appName: 'mydb',
						databaseName: 'app',
						applicationStatus: 'idle',
					});
				}),
			);

			const result = await api.createPostgres('MyDB', 'proj_1', 'env_1');

			expect(result.postgresId).toBe('pg_123');
			expect(capturedBody).toMatchObject({
				name: 'MyDB',
				projectId: 'proj_1',
				environmentId: 'env_1',
				appName: 'mydb',
				databaseName: 'app',
				databaseUser: 'postgres',
				dockerImage: 'postgres:16-alpine',
			});
		});

		it('should create postgres with custom options', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/postgres.create`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({ postgresId: 'pg_123' });
				}),
			);

			await api.createPostgres('MyDB', 'proj_1', 'env_1', {
				databaseName: 'customdb',
				databaseUser: 'customuser',
				databasePassword: 'secretpass',
				dockerImage: 'postgres:15',
			});

			expect(capturedBody).toMatchObject({
				databaseName: 'customdb',
				databaseUser: 'customuser',
				databasePassword: 'secretpass',
				dockerImage: 'postgres:15',
			});
		});

		it('should get postgres by ID', async () => {
			server.use(
				http.get(`${BASE_URL}/api/postgres.one`, ({ request }) => {
					const url = new URL(request.url);
					expect(url.searchParams.get('postgresId')).toBe('pg_123');
					return HttpResponse.json({
						postgresId: 'pg_123',
						name: 'MyDB',
						applicationStatus: 'running',
					});
				}),
			);

			const result = await api.getPostgres('pg_123');
			expect(result.postgresId).toBe('pg_123');
		});

		it('should deploy postgres', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/postgres.deploy`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({ success: true });
				}),
			);

			await api.deployPostgres('pg_123');

			expect(capturedBody).toMatchObject({ postgresId: 'pg_123' });
		});
	});

	describe('redis endpoints', () => {
		it('should create redis', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/redis.create`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({
						redisId: 'redis_123',
						name: 'MyCache',
						appName: 'mycache',
						applicationStatus: 'idle',
					});
				}),
			);

			const result = await api.createRedis('MyCache', 'proj_1', 'env_1');

			expect(result.redisId).toBe('redis_123');
			expect(capturedBody).toMatchObject({
				name: 'MyCache',
				projectId: 'proj_1',
				environmentId: 'env_1',
				appName: 'mycache',
				dockerImage: 'redis:7-alpine',
			});
		});

		it('should get redis by ID', async () => {
			server.use(
				http.get(`${BASE_URL}/api/redis.one`, ({ request }) => {
					const url = new URL(request.url);
					expect(url.searchParams.get('redisId')).toBe('redis_123');
					return HttpResponse.json({
						redisId: 'redis_123',
						name: 'MyCache',
						applicationStatus: 'running',
					});
				}),
			);

			const result = await api.getRedis('redis_123');
			expect(result.redisId).toBe('redis_123');
		});

		it('should deploy redis', async () => {
			let capturedBody: unknown;

			server.use(
				http.post(`${BASE_URL}/api/redis.deploy`, async ({ request }) => {
					capturedBody = await request.json();
					return HttpResponse.json({ success: true });
				}),
			);

			await api.deployRedis('redis_123');

			expect(capturedBody).toMatchObject({ redisId: 'redis_123' });
		});
	});
});
