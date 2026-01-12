import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deployDokploy, validateDokployConfig } from '../dokploy';
import type { DokployDeployConfig } from '../types';

// Mock getDokployToken to return a test token
vi.mock('../../auth', () => ({
	getDokployToken: vi.fn().mockResolvedValue('test-api-token'),
}));

// MSW server for mocking Dokploy API
const server = setupServer();

describe('validateDokployConfig', () => {
	it('should return true for valid complete config', () => {
		const config: DokployDeployConfig = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'proj_123',
			applicationId: 'app_456',
		};

		const result = validateDokployConfig(config);
		expect(result).toBe(true);
	});

	it('should return true with optional registry', () => {
		const config: DokployDeployConfig = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'proj_123',
			applicationId: 'app_456',
			registry: 'ghcr.io/myorg',
		};

		const result = validateDokployConfig(config);
		expect(result).toBe(true);
	});

	it('should return false for undefined config', () => {
		const result = validateDokployConfig(undefined);
		expect(result).toBe(false);
	});

	it('should throw for missing endpoint', () => {
		const config = {
			projectId: 'proj_123',
			applicationId: 'app_456',
		} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: endpoint',
		);
	});

	it('should throw for missing projectId', () => {
		const config = {
			endpoint: 'https://dokploy.example.com',
			applicationId: 'app_456',
		} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: projectId',
		);
	});

	it('should throw for missing applicationId', () => {
		const config = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'proj_123',
		} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: applicationId',
		);
	});

	it('should list all missing fields', () => {
		const config = {
			endpoint: 'https://dokploy.example.com',
		} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: projectId, applicationId',
		);
	});

	it('should throw for empty config object', () => {
		const config = {} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Missing Dokploy configuration: endpoint, projectId, applicationId',
		);
	});

	it('should include configuration example in error', () => {
		const config = {} as Partial<DokployDeployConfig>;

		expect(() => validateDokployConfig(config)).toThrow(
			'Configure in gkm.config.ts:',
		);
	});
});

describe('deployDokploy', () => {
	beforeEach(() => {
		server.listen({ onUnhandledRequest: 'bypass' });
	});

	afterEach(() => {
		server.resetHandlers();
		server.close();
	});

	it('should deploy successfully without master key', async () => {
		server.use(
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
	});

	it('should deploy with master key and update environment', async () => {
		const updateCalls: unknown[] = [];

		server.use(
			http.post(
				'https://dokploy.example.com/api/application.update',
				async ({ request }) => {
					const body = await request.json();
					updateCalls.push(body);
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
		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0]).toMatchObject({
			applicationId: 'app_456',
			env: 'GKM_MASTER_KEY=secret-master-key',
		});
	});

	it('should handle API error with message', async () => {
		server.use(
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
});
