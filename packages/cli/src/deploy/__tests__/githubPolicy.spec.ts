import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	DEFAULT_POLICY_ARN,
	deployAccess,
	scopedPolicyDocument,
} from '../githubPolicy';

/** The parts of a loaded workspace the deploy role's access depends on. */
function workspace(
	parts: Partial<
		Pick<NormalizedWorkspace, 'state' | 'apps' | 'domains' | 'dns'>
	> & {
		target?: string;
		objects?: Record<string, unknown>;
		store?: NormalizedWorkspace['secrets']['store'];
	},
): NormalizedWorkspace {
	return {
		name: 'shop',
		apps: parts.apps ?? {},
		deploy: {
			...(parts.target ? { default: parts.target } : {}),
			...(parts.objects ? { objects: parts.objects } : {}),
		},
		stages: { local: 'dev', deployed: ['prod', 'dev-stage'] },
		secrets: parts.store ? { store: parts.store } : {},
		...(parts.state ? { state: parts.state } : {}),
		...(parts.domains ? { domains: parts.domains } : {}),
		...(parts.dns ? { dns: parts.dns } : {}),
	} as NormalizedWorkspace;
}

describe('deployAccess', () => {
	it('is --policy-arn whenever it is passed', () => {
		expect(
			deployAccess(workspace({ target: 'compose' }), 'prod', 'arn:custom'),
		).toEqual({
			kind: 'managed',
			policyArn: 'arn:custom',
			reason: '--policy-arn',
		});
	});

	it('is AdministratorAccess outside compose', () => {
		for (const target of ['sst', 'dokploy', undefined]) {
			const access = deployAccess(workspace({ target }), 'prod');
			expect(access).toMatchObject({
				kind: 'managed',
				policyArn: DEFAULT_POLICY_ARN,
			});
		}
	});

	it('is AdministratorAccess when an app deploys through another target', () => {
		const access = deployAccess(
			workspace({
				target: 'compose',
				apps: {
					web: { resolvedDeployTarget: 'sst' },
				} as unknown as NormalizedWorkspace['apps'],
			}),
			'prod',
		);

		expect(access).toMatchObject({
			kind: 'managed',
			policyArn: DEFAULT_POLICY_ARN,
			reason:
				'the compose, sst targets deploy infrastructure; --policy-arn to narrow',
		});
	});

	it('is AdministratorAccess for a custom store it cannot scope', () => {
		const store = {
			provider: {
				name: 'vault',
				read: async () => null,
				write: async () => {},
			},
		};

		expect(
			deployAccess(workspace({ target: 'compose', store }), 'prod'),
		).toMatchObject({ kind: 'managed', policyArn: DEFAULT_POLICY_ARN });
	});

	it('allows nothing for file secrets and local state', () => {
		const access = deployAccess(workspace({ target: 'compose' }), 'prod');

		expect(access.kind).toBe('scoped');
		if (access.kind !== 'scoped') return;
		expect(scopedPolicyDocument(access.statements('111'))).toBeNull();
	});

	it('lets the role read and write the stage’s SSM state and take its lock', () => {
		const access = deployAccess(
			workspace({
				target: 'compose',
				state: { provider: 'ssm', region: 'eu-west-1' },
			}),
			'prod',
		);

		if (access.kind !== 'scoped') return expect.unreachable();
		const [statement] = access.statements('111');
		expect(access.statements('111')).toHaveLength(1);
		expect(statement).toEqual({
			Sid: 'StageState',
			Effect: 'Allow',
			// Get and put the state; put (create-only) and delete the lock.
			Action: ['ssm:GetParameter', 'ssm:PutParameter', 'ssm:DeleteParameter'],
			Resource: 'arn:aws:ssm:eu-west-1:111:parameter/gkm/shop/prod/*',
		});
		// The parameters SSMStateStore names, all under that path.
		const covered = (name: string) =>
			`arn:aws:ssm:eu-west-1:111:parameter${name}`.startsWith(
				(statement!.Resource as string).slice(0, -1),
			);
		for (const leaf of ['state', 'lock', 'state.v1']) {
			expect(covered(`/gkm/shop/prod/${leaf}`)).toBe(true);
		}
		expect(covered('/gkm/shop/staging/state')).toBe(false);
	});

	it('adds the stage’s deploy state in S3', () => {
		const access = deployAccess(
			workspace({
				target: 'compose',
				state: { provider: 's3', bucket: 'acme-state', region: 'us-east-1' },
			}),
			'prod',
		);

		if (access.kind !== 'scoped') return expect.unreachable();
		expect(access.statements('111')).toEqual([
			{
				Sid: 'StageState',
				Effect: 'Allow',
				Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
				Resource: 'arn:aws:s3:::acme-state/gkm/shop/prod/*',
			},
			{
				Sid: 'StageStateBucket',
				Effect: 'Allow',
				Action: ['s3:ListBucket'],
				Resource: 'arn:aws:s3:::acme-state',
			},
		]);
	});

	it('creates the project bucket when the S3 state names none, and nothing else', () => {
		const access = deployAccess(
			workspace({
				target: 'compose',
				state: { provider: 's3', region: 'eu-west-1' },
			}),
			'prod',
		);

		if (access.kind !== 'scoped') return expect.unreachable();
		expect(access.describe[0]).toContain(
			'create the project bucket gkm-shop-<account>',
		);
		expect(access.statements('123456789012')).toEqual([
			{
				Sid: 'StageState',
				Effect: 'Allow',
				Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
				Resource: 'arn:aws:s3:::gkm-shop-123456789012/gkm/shop/prod/*',
			},
			{
				Sid: 'StageStateBucket',
				Effect: 'Allow',
				Action: ['s3:ListBucket'],
				Resource: 'arn:aws:s3:::gkm-shop-123456789012',
			},
			{
				Sid: 'ProjectBucket',
				Effect: 'Allow',
				Action: [
					's3:CreateBucket',
					's3:PutBucketVersioning',
					's3:PutEncryptionConfiguration',
					's3:PutBucketPublicAccessBlock',
					's3:PutBucketOwnershipControls',
					's3:PutLifecycleConfiguration',
					's3:PutBucketTagging',
				],
				Resource: 'arn:aws:s3:::gkm-shop-123456789012',
			},
		]);
	});

	describe('secrets in the project bucket', () => {
		const PROJECT_BUCKET = 'arn:aws:s3:::gkm-shop-123456789012';
		const SECRETS = {
			Sid: 'StageSecrets',
			Effect: 'Allow',
			Action: ['s3:GetObject', 's3:PutObject'],
			Resource: `${PROJECT_BUCKET}/gkm/shop/prod/secrets.json`,
		};

		it('reads and updates the one secrets object beside the state, instead of an SSM parameter', () => {
			const inSsm = deployAccess(
				workspace({
					target: 'compose',
					store: { provider: 'ssm', region: 'eu-west-1' },
					state: { provider: 's3', region: 'eu-west-1' },
				}),
				'prod',
			);
			const inS3 = deployAccess(
				workspace({
					target: 'compose',
					store: { provider: 's3' },
					state: { provider: 's3', region: 'eu-west-1' },
				}),
				'prod',
			);

			if (inSsm.kind !== 'scoped' || inS3.kind !== 'scoped') {
				return expect.unreachable();
			}
			expect(inSsm.statements('123456789012')[0]).toMatchObject({
				Sid: 'StageSecrets',
				Action: ['ssm:GetParameter', 'ssm:PutParameter'],
			});
			const statements = inS3.statements('123456789012');
			expect(statements[0]).toEqual(SECRETS);
			// The bucket and its creation come once, from the state.
			expect(statements.map((s) => s.Sid)).toEqual([
				'StageSecrets',
				'StageState',
				'StageStateBucket',
				'ProjectBucket',
			]);
			expect(JSON.stringify(statements)).not.toContain('ssm:');
			expect(inS3.describe[0]).toBe(
				'read and update gkm/shop/prod/secrets.json in the project bucket gkm-shop-<account>',
			);
		});

		it('takes the bucket and its creation itself when the state is elsewhere', () => {
			const access = deployAccess(
				workspace({
					target: 'compose',
					store: { provider: 's3', region: 'eu-west-1' },
					state: { provider: 'ssm', region: 'eu-west-1' },
				}),
				'prod',
			);

			if (access.kind !== 'scoped') return expect.unreachable();
			const statements = access.statements('123456789012');
			expect(statements.slice(0, 3)).toEqual([
				SECRETS,
				{
					Sid: 'StageSecretsBucket',
					Effect: 'Allow',
					Action: ['s3:ListBucket'],
					Resource: PROJECT_BUCKET,
				},
				expect.objectContaining({
					Sid: 'ProjectBucket',
					Resource: PROJECT_BUCKET,
				}),
			]);
			expect(statements.map((s) => s.Sid)).toEqual([
				'StageSecrets',
				'StageSecretsBucket',
				'ProjectBucket',
				'StageState',
			]);
		});

		it('creates nothing in a bucket the config names, under the S3 state’s prefix', () => {
			const access = deployAccess(
				workspace({
					target: 'compose',
					store: { provider: 's3', bucket: 'acme-ops' },
					state: { provider: 's3', region: 'us-east-1', prefix: 'ops/' },
				}),
				'prod',
			);

			if (access.kind !== 'scoped') return expect.unreachable();
			const statements = access.statements('111');
			expect(statements.slice(0, 2)).toEqual([
				{
					Sid: 'StageSecrets',
					Effect: 'Allow',
					Action: ['s3:GetObject', 's3:PutObject'],
					Resource: 'arn:aws:s3:::acme-ops/ops/shop/prod/secrets.json',
				},
				{
					Sid: 'StageSecretsBucket',
					Effect: 'Allow',
					Action: ['s3:ListBucket'],
					Resource: 'arn:aws:s3:::acme-ops',
				},
			]);
			// Only the state's project bucket is created.
			expect(
				statements
					.filter((s) => s.Sid === 'ProjectBucket')
					.map((s) => s.Resource),
			).toEqual(['arn:aws:s3:::gkm-shop-111']);
		});
	});

	it('adds the stage’s deploy state in SSM and a KMS key for its secret', () => {
		const access = deployAccess(
			workspace({
				target: 'compose',
				store: {
					provider: 'secrets-manager',
					region: 'eu-west-1',
					kmsKeyId: 'alias/gkm',
				},
				state: { provider: 'ssm', region: 'eu-west-1' },
			}),
			'prod',
		);

		if (access.kind !== 'scoped') return expect.unreachable();
		const statements = access.statements('111');
		expect(statements.map((s) => s.Sid)).toEqual([
			'StageSecrets',
			'StageSecretsKey',
			'StageState',
		]);
		expect(statements[1]).toMatchObject({
			Action: ['kms:Decrypt', 'kms:GenerateDataKey'],
			Condition: {
				StringEquals: {
					'kms:ViaService': 'secretsmanager.eu-west-1.amazonaws.com',
				},
			},
		});
		expect(statements[2]!.Resource).toBe(
			'arn:aws:ssm:eu-west-1:111:parameter/gkm/shop/prod/*',
		);
	});

	describe("the stage's DNS records", () => {
		const ssm = { provider: 'ssm', region: 'eu-west-1' } as const;

		it("writes the stage's Route53 zone, and only that zone", () => {
			const access = deployAccess(
				workspace({
					target: 'compose',
					store: ssm,
					domains: { prod: 'shop.example.com', dev: 'dev.example.org' },
					dns: {
						'example.com': { provider: 'route53', hostedZoneId: 'Z123' },
						'example.org': { provider: 'route53', hostedZoneId: 'Z999' },
					},
				}),
				'prod',
			);

			if (access.kind !== 'scoped') return expect.unreachable();
			const statements = access.statements('111');
			expect(statements.map((s) => s.Sid)).toEqual([
				'StageSecrets',
				'StageDnsRecords',
				'StageDnsChanges',
			]);
			expect(statements[1]).toMatchObject({
				Action: [
					'route53:ChangeResourceRecordSets',
					'route53:ListResourceRecordSets',
				],
				Resource: 'arn:aws:route53:::hostedzone/Z123',
			});
			expect(statements[2]).toMatchObject({
				Action: ['route53:GetChange'],
			});
			expect(access.describe).toContain(
				'write the A, AAAA and CNAME records of example.com (Route53, Z123)',
			);
		});

		it('looks the zone up by name when no hostedZoneId names it', () => {
			const access = deployAccess(
				workspace({
					target: 'compose',
					store: ssm,
					domains: { prod: 'shop.example.com' },
					dns: { 'example.com': { provider: 'route53' } },
				}),
				'prod',
			);

			if (access.kind !== 'scoped') return expect.unreachable();
			expect(access.statements('111').map((s) => s.Sid)).toEqual([
				'StageSecrets',
				'StageDnsRecords',
				'StageDnsChanges',
				'StageDnsZones',
			]);
		});

		it('grants nothing in Route53 for a domain another provider hosts', () => {
			for (const provider of ['godaddy', 'manual'] as const) {
				const access = deployAccess(
					workspace({
						target: 'compose',
						store: ssm,
						domains: { prod: 'shop.example.com' },
						dns: { 'example.com': { provider } },
					}),
					'prod',
				);

				if (access.kind !== 'scoped') return expect.unreachable();
				expect(
					access
						.statements('111')
						.flatMap((s) => s.Action)
						.filter((a) => a.startsWith('route53:')),
				).toEqual([]);
			}
		});
	});

	describe('the buckets an s3 provider creates', () => {
		const ssm = { provider: 'ssm', region: 'eu-west-1' } as const;

		it('creates and configures exactly those buckets, and their IAM users', () => {
			const access = deployAccess(
				workspace({
					target: 'compose',
					store: ssm,
					objects: { prod: { provider: 's3', region: 'eu-west-1' } },
				}),
				'prod',
				undefined,
				['Uploads', 'Avatars'],
			);

			if (access.kind !== 'scoped') return expect.unreachable();
			const statements = access.statements('111');
			expect(statements.map((s) => s.Sid)).toEqual([
				'StageSecrets',
				'StageBuckets',
				'StageBucketUsers',
			]);
			expect(statements[1]!.Action).toContain('s3:CreateBucket');
			expect(statements[1]!.Action).toContain('s3:PutBucketCORS');
			expect(statements[1]!.Resource).toEqual([
				'arn:aws:s3:::shop-prod-avatars',
				'arn:aws:s3:::shop-prod-avatars-??????',
				'arn:aws:s3:::shop-prod-uploads',
				'arn:aws:s3:::shop-prod-uploads-??????',
			]);
			expect(statements[2]!.Action).toEqual([
				'iam:GetUser',
				'iam:CreateUser',
				'iam:TagUser',
				'iam:ListUserTags',
				'iam:GetUserPolicy',
				'iam:PutUserPolicy',
				'iam:ListAccessKeys',
				'iam:CreateAccessKey',
				'iam:DeleteAccessKey',
			]);
			expect(statements[2]!.Resource).toEqual([
				'arn:aws:iam::111:user/gkm/gkm-shop-prod-avatars',
				'arn:aws:iam::111:user/gkm/gkm-shop-prod-uploads',
			]);
		});

		it('grants nothing in S3 or IAM where the stage sets its keys by hand', () => {
			for (const objects of [undefined, { prod: 'external' }]) {
				const access = deployAccess(
					workspace({
						target: 'compose',
						store: ssm,
						...(objects ? { objects } : {}),
					}),
					'prod',
					undefined,
					['Uploads'],
				);

				if (access.kind !== 'scoped') return expect.unreachable();
				expect(
					access
						.statements('111')
						.flatMap((s) => s.Action)
						.filter((a) => a.startsWith('s3:') || a.startsWith('iam:')),
				).toEqual([]);
			}
		});
	});
});
