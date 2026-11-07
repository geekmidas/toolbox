import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deployDokploy } from '../dokploy';
import { stageTag } from '../identity';
import { generateTag } from '../orchestrate';

// Mock auth functions
vi.mock('../../auth', () => ({
	getDokployToken: vi.fn().mockResolvedValue('test-api-token'),
	getDokployRegistryId: vi.fn().mockResolvedValue(null),
}));

// MSW server for mocking Dokploy API
const server = setupServer();

describe('deployDokploy', () => {
	beforeEach(() => {
		server.listen({ onUnhandledRequest: 'bypass' });
	});

	afterEach(() => {
		server.resetHandlers();
		server.close();
	});

	it('should deploy successfully without master key', async () => {
		const saveDockerCalls: unknown[] = [];

		server.use(
			http.post(
				'https://dokploy.example.com/api/application.saveDockerProvider',
				async ({ request }) => {
					const body = await request.json();
					saveDockerCalls.push(body);
					return HttpResponse.json({ success: true });
				},
			),
			http.post('https://dokploy.example.com/api/application.deploy', () => {
				return HttpResponse.json({ success: true });
			}),
		);

		const result = await deployDokploy({
			stage: 'production',
			tag: 'v1.0.0',
			imageRef: 'ghcr.io/myorg/app:v1.0.0',
			config: {
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
			},
		});

		expect(result.imageRef).toBe('ghcr.io/myorg/app:v1.0.0');
		expect(result.masterKey).toBeUndefined();
		expect(result.url).toBe('https://dokploy.example.com/project/proj_123');
		expect(saveDockerCalls).toHaveLength(1);
		expect(saveDockerCalls[0]).toMatchObject({
			applicationId: 'app_456',
			dockerImage: 'ghcr.io/myorg/app:v1.0.0',
		});
	});

	it('should deploy with master key and update environment', async () => {
		const envCalls: unknown[] = [];

		server.use(
			http.post(
				'https://dokploy.example.com/api/application.saveDockerProvider',
				() => {
					return HttpResponse.json({ success: true });
				},
			),
			http.post(
				'https://dokploy.example.com/api/application.saveEnvironment',
				async ({ request }) => {
					const body = await request.json();
					envCalls.push(body);
					return HttpResponse.json({ success: true });
				},
			),
			http.post('https://dokploy.example.com/api/application.deploy', () => {
				return HttpResponse.json({ success: true });
			}),
		);

		const result = await deployDokploy({
			stage: 'production',
			tag: 'v1.0.0',
			imageRef: 'ghcr.io/myorg/app:v1.0.0',
			masterKey: 'secret-master-key',
			config: {
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
			},
		});

		expect(result.masterKey).toBe('secret-master-key');
		expect(envCalls).toHaveLength(1);
		expect(envCalls[0]).toMatchObject({
			applicationId: 'app_456',
			env: 'GKM_MASTER_KEY=secret-master-key',
		});
	});

	it('should handle API error with message', async () => {
		server.use(
			http.post(
				'https://dokploy.example.com/api/application.saveDockerProvider',
				() => {
					return HttpResponse.json({ success: true });
				},
			),
			http.post('https://dokploy.example.com/api/application.deploy', () => {
				return HttpResponse.json(
					{ message: 'Application not found' },
					{ status: 404 },
				);
			}),
		);

		await expect(
			deployDokploy({
				stage: 'production',
				tag: 'v1.0.0',
				imageRef: 'ghcr.io/myorg/app:v1.0.0',
				config: {
					endpoint: 'https://dokploy.example.com',
					projectId: 'proj_123',
					applicationId: 'app_456',
				},
			}),
		).rejects.toThrow('Dokploy API error: Application not found');
	});

	it('should handle API error with issues', async () => {
		server.use(
			http.post(
				'https://dokploy.example.com/api/application.saveDockerProvider',
				() => {
					return HttpResponse.json({ success: true });
				},
			),
			http.post('https://dokploy.example.com/api/application.deploy', () => {
				return HttpResponse.json(
					{
						message: 'Validation failed',
						issues: [{ message: 'Invalid field' }, { message: 'Missing data' }],
					},
					{ status: 400 },
				);
			}),
		);

		await expect(
			deployDokploy({
				stage: 'production',
				tag: 'v1.0.0',
				imageRef: 'ghcr.io/myorg/app:v1.0.0',
				config: {
					endpoint: 'https://dokploy.example.com',
					projectId: 'proj_123',
					applicationId: 'app_456',
				},
			}),
		).rejects.toThrow('Issues: Invalid field, Missing data');
	});

	it('should handle API error without JSON body', async () => {
		server.use(
			http.post(
				'https://dokploy.example.com/api/application.saveDockerProvider',
				() => {
					return HttpResponse.json({ success: true });
				},
			),
			http.post('https://dokploy.example.com/api/application.deploy', () => {
				return new HttpResponse('Internal Server Error', { status: 500 });
			}),
		);

		await expect(
			deployDokploy({
				stage: 'production',
				tag: 'v1.0.0',
				imageRef: 'ghcr.io/myorg/app:v1.0.0',
				config: {
					endpoint: 'https://dokploy.example.com',
					projectId: 'proj_123',
					applicationId: 'app_456',
				},
			}),
		).rejects.toThrow('Dokploy API error: 500');
	});

	it('should use registryId from config', async () => {
		const saveDockerCalls: unknown[] = [];

		server.use(
			http.post(
				'https://dokploy.example.com/api/application.saveDockerProvider',
				async ({ request }) => {
					const body = await request.json();
					saveDockerCalls.push(body);
					return HttpResponse.json({ success: true });
				},
			),
			http.post('https://dokploy.example.com/api/application.deploy', () => {
				return HttpResponse.json({ success: true });
			}),
		);

		await deployDokploy({
			stage: 'production',
			tag: 'v1.0.0',
			imageRef: 'ghcr.io/myorg/app:v1.0.0',
			config: {
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
				registryId: 'reg_789',
			},
		});

		expect(saveDockerCalls).toHaveLength(1);
		expect(saveDockerCalls[0]).toMatchObject({
			applicationId: 'app_456',
			dockerImage: 'ghcr.io/myorg/app:v1.0.0',
			registryId: 'reg_789',
		});
	});

	it('should use stored registryId when not in config', async () => {
		const { getDokployRegistryId } = await import('../../auth');
		vi.mocked(getDokployRegistryId).mockResolvedValueOnce('stored_reg_123');

		const saveDockerCalls: unknown[] = [];

		server.use(
			http.post(
				'https://dokploy.example.com/api/application.saveDockerProvider',
				async ({ request }) => {
					const body = await request.json();
					saveDockerCalls.push(body);
					return HttpResponse.json({ success: true });
				},
			),
			http.post('https://dokploy.example.com/api/application.deploy', () => {
				return HttpResponse.json({ success: true });
			}),
		);

		await deployDokploy({
			stage: 'production',
			tag: 'v1.0.0',
			imageRef: 'ghcr.io/myorg/app:v1.0.0',
			config: {
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
			},
		});

		expect(saveDockerCalls).toHaveLength(1);
		expect(saveDockerCalls[0]).toMatchObject({
			applicationId: 'app_456',
			dockerImage: 'ghcr.io/myorg/app:v1.0.0',
			registryId: 'stored_reg_123',
		});
	});

	it('should use registryCredentials from config', async () => {
		const saveDockerCalls: unknown[] = [];

		server.use(
			http.post(
				'https://dokploy.example.com/api/application.saveDockerProvider',
				async ({ request }) => {
					const body = await request.json();
					saveDockerCalls.push(body);
					return HttpResponse.json({ success: true });
				},
			),
			http.post('https://dokploy.example.com/api/application.deploy', () => {
				return HttpResponse.json({ success: true });
			}),
		);

		await deployDokploy({
			stage: 'production',
			tag: 'v1.0.0',
			imageRef: 'ghcr.io/myorg/app:v1.0.0',
			config: {
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
				registryCredentials: {
					registryUrl: 'ghcr.io',
					username: 'myuser',
					password: 'mytoken',
				},
			},
		});

		expect(saveDockerCalls).toHaveLength(1);
		expect(saveDockerCalls[0]).toMatchObject({
			applicationId: 'app_456',
			dockerImage: 'ghcr.io/myorg/app:v1.0.0',
			username: 'myuser',
			password: 'mytoken',
			registryUrl: 'ghcr.io',
		});
	});
});

describe('generateTag', () => {
	it('names no stage: each target puts the stage on its images', () => {
		const tag = generateTag();

		expect(tag).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
		expect(stageTag(tag, 'production')).toBe(`${tag}-production`);
	});
});
