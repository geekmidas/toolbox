/**
 * `undeploy` removing what a stage's backups left in AWS, against the
 * emulator, and what it records about DNS records it could not remove.
 *
 * Dokploy is a stand-in; the bucket, its objects and the IAM user are real
 * resources on the emulator, created here and removed by the code under test.
 */

import {
	CreateAccessKeyCommand,
	CreateUserCommand,
	GetUserCommand,
	IAMClient,
	PutUserPolicyCommand,
} from '@aws-sdk/client-iam';
import {
	CreateBucketCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import type { DnsProvider } from '../dns/DnsProvider';
import { DokployApi } from '../dokploy-api';
import { createEmptyState, type DokployStageState } from '../state';
import { undeploy } from '../undeploy';

const ENDPOINT = LOCALSTACK_URL;
const DOKPLOY = 'https://dokploy.test';
const aws = {
	region: 'us-east-1',
	endpoint: ENDPOINT,
	forcePathStyle: true,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};

describe('undeploy', () => {
	const server = setupServer(
		http.post(`${DOKPLOY}/api/destination.remove`, () => HttpResponse.json({})),
	);
	const s3 = new S3Client(aws);
	const iam = new IAMClient(aws);
	const logs: string[] = [];
	const logger = { log: (message: string) => logs.push(message) };
	const api = new DokployApi({ baseUrl: DOKPLOY, token: 'token' });

	beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
	afterEach(() => {
		logs.length = 0;
	});
	afterAll(() => {
		server.close();
		s3.destroy();
		iam.destroy();
	});

	const stateWithBackups = (bucketName: string, iamUserName: string) => {
		const state = createEmptyState('production', 'proj', 'env');
		state.backups = {
			bucketName,
			bucketArn: `arn:aws:s3:::${bucketName}`,
			iamUserName,
			iamAccessKeyId: 'AKIA',
			iamSecretAccessKey: 'secret',
			destinationId: 'dest_1',
			region: 'us-east-1',
			createdAt: '2026-01-01T00:00:00.000Z',
		};
		return state;
	};

	describe('with deleteBackups', () => {
		it('empties and removes the bucket, and the IAM user with its keys and policy', async () => {
			const name = `gkm-undeploy-${Date.now()}`;
			await s3.send(new CreateBucketCommand({ Bucket: name }));
			for (const key of ['2026/01/a.sql.gz', '2026/01/b.sql.gz']) {
				await s3.send(
					new PutObjectCommand({ Bucket: name, Key: key, Body: 'dump' }),
				);
			}
			await iam.send(new CreateUserCommand({ UserName: name }));
			await iam.send(new CreateAccessKeyCommand({ UserName: name }));
			await iam.send(
				new PutUserPolicyCommand({
					UserName: name,
					PolicyName: 'DokployBackupAccess',
					PolicyDocument: JSON.stringify({
						Version: '2012-10-17',
						Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }],
					}),
				}),
			);

			const result = await undeploy({
				api,
				state: stateWithBackups(name, name),
				deleteBackups: true,
				awsEndpoint: ENDPOINT,
				logger,
			});

			expect(result.errors).toEqual([]);
			expect(result.deletedAwsBackupResources).toBe(true);
			expect(result.updatedState.backups).toBeUndefined();
			await expect(
				s3.send(new HeadBucketCommand({ Bucket: name })),
			).rejects.toThrow();
			await expect(
				iam.send(new GetUserCommand({ UserName: name })),
			).rejects.toThrow();
		});

		it('still removes the IAM user when the bucket is already gone', async () => {
			const name = `gkm-undeploy-nobucket-${Date.now()}`;
			await iam.send(new CreateUserCommand({ UserName: name }));
			await iam.send(
				new PutUserPolicyCommand({
					UserName: name,
					PolicyName: 'DokployBackupAccess',
					PolicyDocument: JSON.stringify({
						Version: '2012-10-17',
						Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }],
					}),
				}),
			);

			const result = await undeploy({
				api,
				state: stateWithBackups(name, name),
				deleteBackups: true,
				awsEndpoint: ENDPOINT,
				logger,
			});

			expect(result.deletedAwsBackupResources).toBe(true);
			expect(logs.join('\n')).toContain('Warning: Could not delete bucket');
			await expect(
				iam.send(new GetUserCommand({ UserName: name })),
			).rejects.toThrow();
		});

		it('still removes the bucket when the IAM user is already gone', async () => {
			const name = `gkm-undeploy-nouser-${Date.now()}`;
			await s3.send(new CreateBucketCommand({ Bucket: name }));

			const result = await undeploy({
				api,
				state: stateWithBackups(name, name),
				deleteBackups: true,
				awsEndpoint: ENDPOINT,
				logger,
			});

			expect(result.deletedAwsBackupResources).toBe(true);
			expect(logs.join('\n')).toContain('Warning: Could not delete IAM user');
			await expect(
				s3.send(new HeadBucketCommand({ Bucket: name })),
			).rejects.toThrow();
		});
	});

	describe('DNS records', () => {
		const withRecords = (): DokployStageState => {
			const state = createEmptyState('production', 'proj', 'env');
			for (const name of ['@', 'api', 'stuck']) {
				state.dnsRecords = {
					...state.dnsRecords,
					[`${name}:A`]: {
						domain: 'shop.com',
						name,
						type: 'A',
						value: '1.2.3.4',
						ttl: 300,
						createdAt: '2026-01-01T00:00:00.000Z',
					},
				};
			}
			state.dnsVerified = {
				'shop.com': { serverIp: '1.2.3.4', verifiedAt: 'then' },
				'api.shop.com': { serverIp: '1.2.3.4', verifiedAt: 'then' },
			};
			return state;
		};

		it('forgets what it removed, keeps what failed, and says why', async () => {
			const provider: DnsProvider = {
				name: 'in-memory',
				getRecords: async () => [],
				upsertRecords: async () => [],
				deleteRecords: async (_domain, records) =>
					records.map((record) =>
						record.name === 'stuck'
							? { record, deleted: false, notFound: false, error: 'locked' }
							: { record, deleted: true, notFound: false },
					),
			};

			const result = await undeploy({
				api,
				state: withRecords(),
				dnsProvider: provider,
				logger,
			});

			expect(result.deletedDnsRecords).toEqual(['@:A', 'api:A']);
			expect(Object.keys(result.updatedState.dnsRecords ?? {})).toEqual([
				'stuck:A',
			]);
			// The root record's hostname is the domain itself.
			expect(result.updatedState.dnsVerified).toEqual({});
			expect(result.errors).toEqual([
				'Failed to delete DNS record stuck:A: locked',
			]);
		});

		it('says nothing about a record the provider neither removed nor explained', async () => {
			const provider: DnsProvider = {
				name: 'in-memory',
				getRecords: async () => [],
				upsertRecords: async () => [],
				deleteRecords: async (_domain, records) =>
					records.map((record) => ({
						record,
						deleted: false,
						notFound: false,
					})),
			};

			const result = await undeploy({
				api,
				state: withRecords(),
				dnsProvider: provider,
				logger,
			});

			expect(result.deletedDnsRecords).toEqual([]);
			expect(result.errors).toEqual([]);
			expect(Object.keys(result.updatedState.dnsRecords ?? {})).toHaveLength(3);
		});
	});
});
