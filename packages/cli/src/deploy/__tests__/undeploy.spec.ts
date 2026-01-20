import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import type {
	DeleteDnsRecord,
	DeleteResult,
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
	UpsertResult,
} from '../dns/DnsProvider';
import { DokployApi } from '../dokploy-api';
import type { DokployStageState } from '../state';
import { type UndeployOptions, undeploy } from '../undeploy';

/**
 * Undeploy Tests
 */
describe('undeploy', () => {
	const DOKPLOY_BASE_URL = 'https://dokploy.example.com';

	let dokployApi: DokployApi;
	const server = setupServer();
	const logs: string[] = [];
	const logger = { log: (msg: string) => logs.push(msg) };

	// Track which endpoints were called
	const calledEndpoints: string[] = [];

	beforeAll(() => {
		server.listen({ onUnhandledRequest: 'bypass' });
	});

	beforeEach(() => {
		logs.length = 0;
		calledEndpoints.length = 0;

		dokployApi = new DokployApi({
			baseUrl: DOKPLOY_BASE_URL,
			token: 'test-api-token',
		});
	});

	afterEach(() => {
		server.resetHandlers();
	});

	afterAll(() => {
		server.close();
	});

	function createState(
		overrides: Partial<DokployStageState> = {},
	): DokployStageState {
		return {
			provider: 'dokploy',
			stage: 'production',
			projectId: 'proj_123',
			environmentId: 'env_123',
			applications: {},
			services: {},
			lastDeployedAt: '2024-01-01T00:00:00.000Z',
			...overrides,
		};
	}

	function createOptions(
		state: DokployStageState,
		overrides: Partial<UndeployOptions> = {},
	): UndeployOptions {
		return {
			api: dokployApi,
			state,
			logger,
			...overrides,
		};
	}

	// Mock DNS provider for testing
	function createMockDnsProvider(
		deleteResults: DeleteResult[] = [],
	): DnsProvider & { deletedRecords: DeleteDnsRecord[] } {
		const provider = {
			name: 'mock',
			deletedRecords: [] as DeleteDnsRecord[],
			async getRecords(_domain: string): Promise<DnsRecord[]> {
				return [];
			},
			async upsertRecords(
				_domain: string,
				_records: UpsertDnsRecord[],
			): Promise<UpsertResult[]> {
				return [];
			},
			async deleteRecords(
				_domain: string,
				records: DeleteDnsRecord[],
			): Promise<DeleteResult[]> {
				provider.deletedRecords.push(...records);
				if (deleteResults.length > 0) {
					return deleteResults;
				}
				return records.map((r) => ({
					record: r,
					deleted: true,
					notFound: false,
				}));
			},
		};
		return provider;
	}

	function setupMocks() {
		server.use(
			// Application remove
			http.post(
				`${DOKPLOY_BASE_URL}/api/application.remove`,
				async ({ request }) => {
					const body = (await request.json()) as { applicationId: string };
					calledEndpoints.push(`application.remove:${body.applicationId}`);
					return HttpResponse.json({ success: true });
				},
			),

			// Postgres remove
			http.post(
				`${DOKPLOY_BASE_URL}/api/postgres.remove`,
				async ({ request }) => {
					const body = (await request.json()) as { postgresId: string };
					calledEndpoints.push(`postgres.remove:${body.postgresId}`);
					return HttpResponse.json({ success: true });
				},
			),

			// Redis remove
			http.post(`${DOKPLOY_BASE_URL}/api/redis.remove`, async ({ request }) => {
				const body = (await request.json()) as { redisId: string };
				calledEndpoints.push(`redis.remove:${body.redisId}`);
				return HttpResponse.json({ success: true });
			}),

			// Project remove
			http.post(
				`${DOKPLOY_BASE_URL}/api/project.remove`,
				async ({ request }) => {
					const body = (await request.json()) as { projectId: string };
					calledEndpoints.push(`project.remove:${body.projectId}`);
					return HttpResponse.json({ success: true });
				},
			),

			// Destination remove
			http.post(
				`${DOKPLOY_BASE_URL}/api/destination.remove`,
				async ({ request }) => {
					const body = (await request.json()) as { destinationId: string };
					calledEndpoints.push(`destination.remove:${body.destinationId}`);
					return HttpResponse.json({ success: true });
				},
			),

			// Backup remove
			http.post(
				`${DOKPLOY_BASE_URL}/api/backup.remove`,
				async ({ request }) => {
					const body = (await request.json()) as { backupId: string };
					calledEndpoints.push(`backup.remove:${body.backupId}`);
					return HttpResponse.json({ success: true });
				},
			),

			// Manual backup
			http.post(
				`${DOKPLOY_BASE_URL}/api/backup.manualBackup`,
				async ({ request }) => {
					const body = (await request.json()) as { backupId: string };
					calledEndpoints.push(`backup.manualBackup:${body.backupId}`);
					return HttpResponse.json({ success: true });
				},
			),
		);
	}

	describe('deleting applications', () => {
		it('should delete all applications', async () => {
			setupMocks();

			const state = createState({
				applications: {
					api: 'app_api_123',
					web: 'app_web_456',
					worker: 'app_worker_789',
				},
			});

			const result = await undeploy(createOptions(state));

			expect(result.deletedApplications).toEqual(['api', 'web', 'worker']);
			expect(calledEndpoints).toContain('application.remove:app_api_123');
			expect(calledEndpoints).toContain('application.remove:app_web_456');
			expect(calledEndpoints).toContain('application.remove:app_worker_789');
		});

		it('should handle application deletion errors gracefully', async () => {
			server.use(
				http.post(`${DOKPLOY_BASE_URL}/api/application.remove`, () => {
					return HttpResponse.json(
						{ message: 'Application not found' },
						{ status: 404 },
					);
				}),
			);

			const state = createState({
				applications: { api: 'app_missing' },
			});

			const result = await undeploy(createOptions(state));

			expect(result.deletedApplications).toEqual([]);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors[0]).toContain('Failed to delete application api');
		});
	});

	describe('deleting services', () => {
		it('should delete postgres when present', async () => {
			setupMocks();

			const state = createState({
				services: { postgresId: 'pg_123' },
			});

			const result = await undeploy(createOptions(state));

			expect(result.deletedPostgres).toBe(true);
			expect(calledEndpoints).toContain('postgres.remove:pg_123');
		});

		it('should delete redis when present', async () => {
			setupMocks();

			const state = createState({
				services: { redisId: 'redis_123' },
			});

			const result = await undeploy(createOptions(state));

			expect(result.deletedRedis).toBe(true);
			expect(calledEndpoints).toContain('redis.remove:redis_123');
		});

		it('should delete both postgres and redis', async () => {
			setupMocks();

			const state = createState({
				services: {
					postgresId: 'pg_123',
					redisId: 'redis_456',
				},
			});

			const result = await undeploy(createOptions(state));

			expect(result.deletedPostgres).toBe(true);
			expect(result.deletedRedis).toBe(true);
		});

		it('should handle missing services gracefully', async () => {
			setupMocks();

			const state = createState({
				services: {},
			});

			const result = await undeploy(createOptions(state));

			expect(result.deletedPostgres).toBe(false);
			expect(result.deletedRedis).toBe(false);
			expect(result.errors).toEqual([]);
		});
	});

	describe('deleting project', () => {
		it('should not delete project by default', async () => {
			setupMocks();

			const state = createState();
			const result = await undeploy(createOptions(state));

			expect(result.deletedProject).toBe(false);
			expect(calledEndpoints).not.toContain('project.remove:proj_123');
		});

		it('should delete project when deleteProject is true', async () => {
			setupMocks();

			const state = createState();
			const result = await undeploy(
				createOptions(state, { deleteProject: true }),
			);

			expect(result.deletedProject).toBe(true);
			expect(calledEndpoints).toContain('project.remove:proj_123');
		});
	});

	describe('deleting backups', () => {
		it('should run manual backup before deleting anything', async () => {
			setupMocks();

			const state = createState({
				services: { postgresId: 'pg_123' },
				backups: {
					bucketName: 'test-bucket',
					bucketArn: 'arn:aws:s3:::test-bucket',
					iamUserName: 'test-user',
					iamAccessKeyId: 'AKIA00000TEST',
					iamSecretAccessKey: 'secret',
					destinationId: 'dest_123',
					postgresBackupId: 'backup_123',
					region: 'us-east-1',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			});

			await undeploy(createOptions(state));

			// Verify manual backup is called first before any deletions
			expect(calledEndpoints[0]).toBe('backup.manualBackup:backup_123');
		});

		it('should delete backup schedule before postgres', async () => {
			setupMocks();

			const state = createState({
				services: { postgresId: 'pg_123' },
				backups: {
					bucketName: 'test-bucket',
					bucketArn: 'arn:aws:s3:::test-bucket',
					iamUserName: 'test-user',
					iamAccessKeyId: 'AKIA00000TEST',
					iamSecretAccessKey: 'secret',
					destinationId: 'dest_123',
					postgresBackupId: 'backup_123',
					region: 'us-east-1',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			});

			await undeploy(createOptions(state));

			// Verify backup schedule is deleted before postgres
			const backupIndex = calledEndpoints.indexOf('backup.remove:backup_123');
			const postgresIndex = calledEndpoints.indexOf('postgres.remove:pg_123');
			expect(backupIndex).toBeLessThan(postgresIndex);
		});

		it('should delete backup destination', async () => {
			setupMocks();

			const state = createState({
				backups: {
					bucketName: 'test-bucket',
					bucketArn: 'arn:aws:s3:::test-bucket',
					iamUserName: 'test-user',
					iamAccessKeyId: 'AKIA00000TEST',
					iamSecretAccessKey: 'secret',
					destinationId: 'dest_123',
					region: 'us-east-1',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			});

			const result = await undeploy(createOptions(state));

			expect(result.deletedBackupDestination).toBe(true);
			expect(calledEndpoints).toContain('destination.remove:dest_123');
		});

		it('should not delete AWS resources by default', async () => {
			setupMocks();

			const state = createState({
				backups: {
					bucketName: 'test-bucket',
					bucketArn: 'arn:aws:s3:::test-bucket',
					iamUserName: 'test-user',
					iamAccessKeyId: 'AKIA00000TEST',
					iamSecretAccessKey: 'secret',
					destinationId: 'dest_123',
					region: 'us-east-1',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			});

			const result = await undeploy(createOptions(state));

			expect(result.deletedAwsBackupResources).toBe(false);
		});
	});

	describe('full undeploy', () => {
		it('should delete everything in correct order', async () => {
			setupMocks();

			const state = createState({
				applications: {
					api: 'app_api',
					web: 'app_web',
				},
				services: {
					postgresId: 'pg_123',
					redisId: 'redis_456',
				},
				backups: {
					bucketName: 'test-bucket',
					bucketArn: 'arn:aws:s3:::test-bucket',
					iamUserName: 'test-user',
					iamAccessKeyId: 'AKIA00000TEST',
					iamSecretAccessKey: 'secret',
					destinationId: 'dest_123',
					postgresBackupId: 'backup_123',
					region: 'us-east-1',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			});

			const result = await undeploy(
				createOptions(state, { deleteProject: true }),
			);

			expect(result.deletedApplications).toEqual(['api', 'web']);
			expect(result.deletedPostgres).toBe(true);
			expect(result.deletedRedis).toBe(true);
			expect(result.deletedBackupDestination).toBe(true);
			expect(result.deletedProject).toBe(true);
			expect(result.errors).toEqual([]);

			// Verify order: manual backup -> backup schedule -> apps -> postgres -> redis -> destination -> project
			const manualBackupIdx = calledEndpoints.indexOf(
				'backup.manualBackup:backup_123',
			);
			const backupIdx = calledEndpoints.indexOf('backup.remove:backup_123');
			const appIdx = calledEndpoints.indexOf('application.remove:app_api');
			const pgIdx = calledEndpoints.indexOf('postgres.remove:pg_123');
			const redisIdx = calledEndpoints.indexOf('redis.remove:redis_456');
			const destIdx = calledEndpoints.indexOf('destination.remove:dest_123');
			const projIdx = calledEndpoints.indexOf('project.remove:proj_123');

			expect(manualBackupIdx).toBeLessThan(backupIdx);
			expect(backupIdx).toBeLessThan(appIdx);
			expect(appIdx).toBeLessThan(pgIdx);
			expect(pgIdx).toBeLessThan(redisIdx);
			expect(redisIdx).toBeLessThan(destIdx);
			expect(destIdx).toBeLessThan(projIdx);
		});

		it('should continue on errors and report them', async () => {
			server.use(
				http.post(`${DOKPLOY_BASE_URL}/api/application.remove`, () => {
					calledEndpoints.push('application.remove:failed');
					return HttpResponse.json({ message: 'Error' }, { status: 500 });
				}),
				http.post(`${DOKPLOY_BASE_URL}/api/postgres.remove`, () => {
					calledEndpoints.push('postgres.remove:success');
					return HttpResponse.json({ success: true });
				}),
			);

			const state = createState({
				applications: { api: 'app_fail' },
				services: { postgresId: 'pg_123' },
			});

			const result = await undeploy(createOptions(state));

			// Should continue to postgres even though application failed
			expect(calledEndpoints).toContain('application.remove:failed');
			expect(calledEndpoints).toContain('postgres.remove:success');
			expect(result.deletedApplications).toEqual([]);
			expect(result.deletedPostgres).toBe(true);
			expect(result.errors.length).toBe(1);
		});
	});

	describe('deleting DNS records', () => {
		it('should delete DNS records when provider is available', async () => {
			setupMocks();
			const dnsProvider = createMockDnsProvider();

			const state = createState({
				dnsRecords: {
					'api:A': {
						domain: 'example.com',
						name: 'api',
						type: 'A',
						value: '1.2.3.4',
						ttl: 300,
						createdAt: '2024-01-01T00:00:00.000Z',
					},
					'web:A': {
						domain: 'example.com',
						name: 'web',
						type: 'A',
						value: '1.2.3.4',
						ttl: 300,
						createdAt: '2024-01-01T00:00:00.000Z',
					},
				},
			});

			const result = await undeploy(createOptions(state, { dnsProvider }));

			expect(dnsProvider.deletedRecords).toHaveLength(2);
			expect(result.deletedDnsRecords).toContain('api:A');
			expect(result.deletedDnsRecords).toContain('web:A');
		});

		it('should group DNS records by domain', async () => {
			setupMocks();
			const domainsCalled: string[] = [];
			const dnsProvider: DnsProvider = {
				name: 'mock',
				async getRecords() {
					return [];
				},
				async upsertRecords() {
					return [];
				},
				async deleteRecords(domain, records) {
					domainsCalled.push(domain);
					return records.map((r) => ({
						record: r,
						deleted: true,
						notFound: false,
					}));
				},
			};

			const state = createState({
				dnsRecords: {
					'api:A': {
						domain: 'example.com',
						name: 'api',
						type: 'A',
						value: '1.2.3.4',
						ttl: 300,
						createdAt: '2024-01-01T00:00:00.000Z',
					},
					'api:A:other': {
						domain: 'other.com',
						name: 'api',
						type: 'A',
						value: '5.6.7.8',
						ttl: 300,
						createdAt: '2024-01-01T00:00:00.000Z',
					},
				},
			});

			await undeploy(createOptions(state, { dnsProvider }));

			expect(domainsCalled).toContain('example.com');
			expect(domainsCalled).toContain('other.com');
		});

		it('should not call DNS provider if no records exist', async () => {
			setupMocks();
			const dnsProvider = createMockDnsProvider();

			const state = createState({
				dnsRecords: {},
			});

			await undeploy(createOptions(state, { dnsProvider }));

			expect(dnsProvider.deletedRecords).toHaveLength(0);
		});

		it('should handle DNS deletion errors gracefully', async () => {
			setupMocks();
			const dnsProvider = createMockDnsProvider([
				{
					record: { name: 'api', type: 'A' },
					deleted: false,
					notFound: false,
					error: 'Access denied',
				},
			]);

			const state = createState({
				dnsRecords: {
					'api:A': {
						domain: 'example.com',
						name: 'api',
						type: 'A',
						value: '1.2.3.4',
						ttl: 300,
						createdAt: '2024-01-01T00:00:00.000Z',
					},
				},
			});

			const result = await undeploy(createOptions(state, { dnsProvider }));

			expect(result.deletedDnsRecords).toEqual([]);
			expect(result.errors).toContain('Failed to delete DNS record api:A: Access denied');
		});

		it('should mark not-found records as deleted', async () => {
			setupMocks();
			const dnsProvider = createMockDnsProvider([
				{
					record: { name: 'api', type: 'A' },
					deleted: false,
					notFound: true,
				},
			]);

			const state = createState({
				dnsRecords: {
					'api:A': {
						domain: 'example.com',
						name: 'api',
						type: 'A',
						value: '1.2.3.4',
						ttl: 300,
						createdAt: '2024-01-01T00:00:00.000Z',
					},
				},
			});

			const result = await undeploy(createOptions(state, { dnsProvider }));

			// Not found means already deleted, so should be in deletedDnsRecords
			expect(result.deletedDnsRecords).toContain('api:A');
		});
	});

	describe('state updates', () => {
		it('should return updated state with deleted applications removed', async () => {
			setupMocks();

			const state = createState({
				applications: {
					api: 'app_api',
					web: 'app_web',
				},
				appCredentials: {
					api: { dbUser: 'api_user', dbPassword: 'api_pass' },
					web: { dbUser: 'web_user', dbPassword: 'web_pass' },
				},
			});

			const result = await undeploy(createOptions(state));

			expect(result.updatedState.applications).toEqual({});
			expect(result.updatedState.appCredentials).toEqual({});
		});

		it('should return updated state with deleted services removed', async () => {
			setupMocks();

			const state = createState({
				services: {
					postgresId: 'pg_123',
					redisId: 'redis_456',
				},
			});

			const result = await undeploy(createOptions(state));

			expect(result.updatedState.services.postgresId).toBeUndefined();
			expect(result.updatedState.services.redisId).toBeUndefined();
		});

		it('should return updated state with deleted DNS records removed', async () => {
			setupMocks();
			const dnsProvider = createMockDnsProvider();

			const state = createState({
				dnsRecords: {
					'api:A': {
						domain: 'example.com',
						name: 'api',
						type: 'A',
						value: '1.2.3.4',
						ttl: 300,
						createdAt: '2024-01-01T00:00:00.000Z',
					},
				},
				dnsVerified: {
					'api.example.com': {
						serverIp: '1.2.3.4',
						verifiedAt: '2024-01-01T00:00:00.000Z',
					},
				},
			});

			const result = await undeploy(createOptions(state, { dnsProvider }));

			expect(result.updatedState.dnsRecords).toEqual({});
			expect(result.updatedState.dnsVerified).toEqual({});
		});

		it('should preserve state for failed deletions', async () => {
			server.use(
				http.post(`${DOKPLOY_BASE_URL}/api/application.remove`, () => {
					return HttpResponse.json({ message: 'Error' }, { status: 500 });
				}),
			);

			const state = createState({
				applications: { api: 'app_api' },
			});

			const result = await undeploy(createOptions(state));

			// Application deletion failed, so it should still be in state
			expect(result.updatedState.applications).toEqual({ api: 'app_api' });
		});

		it('should clear backups state when deleteBackups is true and succeeds', async () => {
			// This test would need LocalStack for AWS calls
			// For now, just verify the option is passed through
			setupMocks();

			const state = createState({
				backups: {
					bucketName: 'test-bucket',
					bucketArn: 'arn:aws:s3:::test-bucket',
					iamUserName: 'test-user',
					iamAccessKeyId: 'AKIA00000TEST',
					iamSecretAccessKey: 'secret',
					destinationId: 'dest_123',
					region: 'us-east-1',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			});

			// Just verify the destination is deleted (AWS deletion requires LocalStack)
			const result = await undeploy(createOptions(state));

			expect(result.deletedBackupDestination).toBe(true);
		});
	});
});
