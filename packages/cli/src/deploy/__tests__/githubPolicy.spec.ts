import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	DEFAULT_POLICY_ARN,
	deployAccess,
	scopedPolicyDocument,
} from '../githubPolicy';

/** The parts of a loaded workspace the deploy role's access depends on. */
function workspace(
	parts: Partial<Pick<NormalizedWorkspace, 'state' | 'apps'>> & {
		target?: string;
		store?: NormalizedWorkspace['secrets']['store'];
	},
): NormalizedWorkspace {
	return {
		name: 'shop',
		apps: parts.apps ?? {},
		deploy: parts.target ? { default: parts.target } : {},
		secrets: parts.store ? { store: parts.store } : {},
		...(parts.state ? { state: parts.state } : {}),
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
});
