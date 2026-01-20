import {
	DeleteAccessKeyCommand,
	DeleteUserCommand,
	DeleteUserPolicyCommand,
	GetUserCommand,
	IAMClient,
	ListAccessKeysCommand,
} from '@aws-sdk/client-iam';
import {
	DeleteBucketCommand,
	DeleteObjectsCommand,
	ListObjectsV2Command,
	S3Client,
} from '@aws-sdk/client-s3';
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
import {
	type ProvisionBackupOptions,
	provisionBackupDestination,
} from '../backup-provisioner';
import { DokployApi } from '../dokploy-api';
import type { BackupState } from '../state';

/**
 * Backup Provisioner Tests
 *
 * These tests require LocalStack to be running with S3 and IAM enabled.
 * Run: docker compose up -d localstack
 */
describe('backup-provisioner', () => {
	const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
	const DOKPLOY_BASE_URL = 'https://dokploy.example.com';

	let s3Client: S3Client;
	let iamClient: IAMClient;
	let dokployApi: DokployApi;

	const server = setupServer();
	const logs: string[] = [];
	const logger = { log: (msg: string) => logs.push(msg) };

	// Track created resources for cleanup
	const createdBuckets: string[] = [];
	const createdUsers: string[] = [];

	beforeAll(() => {
		process.env.AWS_ACCESS_KEY_ID = 'test';
		process.env.AWS_SECRET_ACCESS_KEY = 'test';
		server.listen({ onUnhandledRequest: 'bypass' });
	});

	beforeEach(() => {
		logs.length = 0;

		s3Client = new S3Client({
			region: 'us-east-1',
			endpoint: LOCALSTACK_ENDPOINT,
			forcePathStyle: true,
			credentials: {
				accessKeyId: 'test',
				secretAccessKey: 'test',
			},
		});

		iamClient = new IAMClient({
			region: 'us-east-1',
			endpoint: LOCALSTACK_ENDPOINT,
			credentials: {
				accessKeyId: 'test',
				secretAccessKey: 'test',
			},
		});

		dokployApi = new DokployApi({
			baseUrl: DOKPLOY_BASE_URL,
			token: 'test-api-token',
		});
	});

	afterEach(async () => {
		server.resetHandlers();

		// Cleanup created buckets
		for (const bucket of createdBuckets) {
			try {
				// First delete all objects in the bucket
				const objects = await s3Client.send(
					new ListObjectsV2Command({ Bucket: bucket }),
				);
				if (objects.Contents?.length) {
					await s3Client.send(
						new DeleteObjectsCommand({
							Bucket: bucket,
							Delete: {
								Objects: objects.Contents.map((o) => ({ Key: o.Key })),
							},
						}),
					);
				}
				await s3Client.send(new DeleteBucketCommand({ Bucket: bucket }));
			} catch {
				// Ignore cleanup errors
			}
		}
		createdBuckets.length = 0;

		// Cleanup created IAM users
		for (const userName of createdUsers) {
			try {
				// Delete access keys first
				const keys = await iamClient.send(
					new ListAccessKeysCommand({ UserName: userName }),
				);
				for (const key of keys.AccessKeyMetadata ?? []) {
					await iamClient.send(
						new DeleteAccessKeyCommand({
							UserName: userName,
							AccessKeyId: key.AccessKeyId,
						}),
					);
				}
				// Delete user policy
				await iamClient.send(
					new DeleteUserPolicyCommand({
						UserName: userName,
						PolicyName: 'DokployBackupAccess',
					}),
				);
				// Delete user
				await iamClient.send(new DeleteUserCommand({ UserName: userName }));
			} catch {
				// Ignore cleanup errors
			}
		}
		createdUsers.length = 0;
	});

	afterAll(() => {
		server.close();
		s3Client.destroy();
		iamClient.destroy();
	});

	/**
	 * Helper to create provision options with LocalStack clients
	 */
	function createOptions(
		overrides: Partial<ProvisionBackupOptions> = {},
	): ProvisionBackupOptions {
		return {
			api: dokployApi,
			projectId: 'proj_test123',
			projectName: 'test-project',
			stage: 'production',
			config: {
				type: 's3',
				region: 'us-east-1',
			},
			logger,
			awsEndpoint: LOCALSTACK_ENDPOINT,
			...overrides,
		};
	}

	/**
	 * Setup mock Dokploy API responses
	 */
	function setupDokployMocks(options: {
		existingDestination?: { destinationId: string; name: string };
		createDestinationId?: string;
	}) {
		const handlers = [
			// List destinations
			http.get(`${DOKPLOY_BASE_URL}/api/destination.all`, () => {
				if (options.existingDestination) {
					return HttpResponse.json([options.existingDestination]);
				}
				return HttpResponse.json([]);
			}),

			// Get destination
			http.get(`${DOKPLOY_BASE_URL}/api/destination.one`, ({ request }) => {
				const url = new URL(request.url);
				const destId = url.searchParams.get('destinationId');
				if (
					options.existingDestination &&
					destId === options.existingDestination.destinationId
				) {
					return HttpResponse.json(options.existingDestination);
				}
				return HttpResponse.json({ message: 'Not found' }, { status: 404 });
			}),

			// Create destination
			http.post(`${DOKPLOY_BASE_URL}/api/destination.create`, () => {
				return HttpResponse.json({
					destinationId: options.createDestinationId ?? 'dest_new123',
					name: 'test-project-production-s3',
				});
			}),

			// Test destination connection
			http.post(`${DOKPLOY_BASE_URL}/api/destination.testConnection`, () => {
				return HttpResponse.json({ success: true });
			}),
		];

		server.use(...handlers);
	}

	describe('provisionBackupDestination', () => {
		it('should create S3 bucket with unique name', async () => {
			setupDokployMocks({ createDestinationId: 'dest_123' });

			const options = createOptions();
			const result = await provisionBackupDestination(options);

			// Track for cleanup
			createdBuckets.push(result.bucketName);
			createdUsers.push(result.iamUserName);

			expect(result.bucketName).toMatch(/^test-project-production-backups-/);
			expect(result.bucketArn).toBe(`arn:aws:s3:::${result.bucketName}`);
			expect(logs.some((l) => l.includes('Creating S3 bucket'))).toBe(true);
		});

		it('should create IAM user with correct name', async () => {
			setupDokployMocks({ createDestinationId: 'dest_123' });

			const options = createOptions();
			const result = await provisionBackupDestination(options);

			// Track for cleanup
			createdBuckets.push(result.bucketName);
			createdUsers.push(result.iamUserName);

			expect(result.iamUserName).toBe('dokploy-backup-test-project-production');

			// Verify user exists in IAM
			const userResponse = await iamClient.send(
				new GetUserCommand({ UserName: result.iamUserName }),
			);
			expect(userResponse.User?.UserName).toBe(result.iamUserName);
		});

		it('should create IAM access key', async () => {
			setupDokployMocks({ createDestinationId: 'dest_123' });

			const options = createOptions();
			const result = await provisionBackupDestination(options);

			// Track for cleanup
			createdBuckets.push(result.bucketName);
			createdUsers.push(result.iamUserName);

			expect(result.iamAccessKeyId).toBeDefined();
			expect(result.iamSecretAccessKey).toBeDefined();
			expect(result.iamAccessKeyId.length).toBeGreaterThan(0);
			expect(result.iamSecretAccessKey.length).toBeGreaterThan(0);
		});

		it('should create Dokploy destination', async () => {
			setupDokployMocks({ createDestinationId: 'dest_created' });

			const options = createOptions();
			const result = await provisionBackupDestination(options);

			// Track for cleanup
			createdBuckets.push(result.bucketName);
			createdUsers.push(result.iamUserName);

			expect(result.destinationId).toBe('dest_created');
			expect(logs.some((l) => l.includes('Dokploy destination created'))).toBe(
				true,
			);
		});

		it('should reuse existing state when destination still exists', async () => {
			const existingState: BackupState = {
				bucketName: 'existing-bucket',
				bucketArn: 'arn:aws:s3:::existing-bucket',
				iamUserName: 'existing-user',
				iamAccessKeyId: 'AKIA123',
				iamSecretAccessKey: 'secret123',
				destinationId: 'dest_existing',
				region: 'us-east-1',
				createdAt: '2024-01-01T00:00:00.000Z',
			};

			setupDokployMocks({
				existingDestination: {
					destinationId: 'dest_existing',
					name: 'existing',
				},
			});

			const options = createOptions({ existingState });
			const result = await provisionBackupDestination(options);

			// Should return existing state without creating new resources
			expect(result).toEqual(existingState);
			expect(
				logs.some((l) => l.includes('Using existing backup destination')),
			).toBe(true);
		});

		it('should recreate destination if existing one not found', async () => {
			const existingState: BackupState = {
				bucketName: 'existing-bucket',
				bucketArn: 'arn:aws:s3:::existing-bucket',
				iamUserName: 'dokploy-backup-test-project-production',
				iamAccessKeyId: 'AKIA123',
				iamSecretAccessKey: 'secret123',
				destinationId: 'dest_deleted',
				region: 'us-east-1',
				createdAt: '2024-01-01T00:00:00.000Z',
			};

			// Mock: destination.one returns 404, meaning destination was deleted
			setupDokployMocks({ createDestinationId: 'dest_new' });

			const options = createOptions({ existingState });
			const result = await provisionBackupDestination(options);

			// Track for cleanup (uses existing bucket name from state)
			createdBuckets.push(result.bucketName);
			createdUsers.push(result.iamUserName);

			// Should reuse bucket name from state
			expect(result.bucketName).toBe('existing-bucket');
			// Should reuse IAM user name
			expect(result.iamUserName).toBe('dokploy-backup-test-project-production');
			// Should reuse credentials from state
			expect(result.iamAccessKeyId).toBe('AKIA123');
			// Should create new destination
			expect(result.destinationId).toBe('dest_new');
			expect(
				logs.some((l) => l.includes('Existing destination not found')),
			).toBe(true);
		});

		it('should sanitize project name for AWS resources', async () => {
			setupDokployMocks({ createDestinationId: 'dest_123' });

			const options = createOptions({
				projectName: 'My Project_Name!@#',
			});
			const result = await provisionBackupDestination(options);

			// Track for cleanup
			createdBuckets.push(result.bucketName);
			createdUsers.push(result.iamUserName);

			// Should be lowercase with only alphanumeric and hyphens
			// 'My Project_Name!@#' -> 'my-project-name----' (space, underscore, !, @, # all become hyphens)
			expect(result.bucketName).toMatch(
				/^my-project-name----production-backups-/,
			);
			expect(result.iamUserName).toBe(
				'dokploy-backup-my-project-name----production',
			);
		});

		it('should return complete BackupState', async () => {
			setupDokployMocks({ createDestinationId: 'dest_complete' });

			const options = createOptions();
			const result = await provisionBackupDestination(options);

			// Track for cleanup
			createdBuckets.push(result.bucketName);
			createdUsers.push(result.iamUserName);

			expect(result).toMatchObject({
				bucketName: expect.stringMatching(/^test-project-production-backups-/),
				bucketArn: expect.stringMatching(/^arn:aws:s3:::/),
				iamUserName: 'dokploy-backup-test-project-production',
				iamAccessKeyId: expect.any(String),
				iamSecretAccessKey: expect.any(String),
				destinationId: 'dest_complete',
				region: 'us-east-1',
				createdAt: expect.any(String),
			});
		});

		it('should handle connection test failure gracefully', async () => {
			server.use(
				http.get(`${DOKPLOY_BASE_URL}/api/destination.all`, () => {
					return HttpResponse.json([]);
				}),
				http.post(`${DOKPLOY_BASE_URL}/api/destination.create`, () => {
					return HttpResponse.json({
						destinationId: 'dest_123',
						name: 'test',
					});
				}),
				http.post(`${DOKPLOY_BASE_URL}/api/destination.testConnection`, () => {
					return HttpResponse.json(
						{ message: 'Connection failed' },
						{ status: 500 },
					);
				}),
			);

			const options = createOptions();
			const result = await provisionBackupDestination(options);

			// Track for cleanup
			createdBuckets.push(result.bucketName);
			createdUsers.push(result.iamUserName);

			// Should still succeed but log warning
			expect(result.destinationId).toBe('dest_123');
			expect(
				logs.some((l) => l.includes('Warning: Could not verify destination')),
			).toBe(true);
		});
	});
});
