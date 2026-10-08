/**
 * What the deploy role may do in the stage's account.
 *
 * An SST stage creates its own stack, which is most of AWS, so its role gets
 * `AdministratorAccess`. A stage deployed with the `compose` target builds and
 * runs containers on a server; from AWS its deploy job needs only the stage's
 * secrets — read, and written back when a deploy generates a new one — and,
 * when the deploy state is kept in AWS, the stage's state. So a compose stage
 * gets an inline policy naming exactly those resources and nothing else.
 *
 * `--policy-arn` replaces either.
 */

import { secretsParameterName } from '../secrets/aws.js';
import { secretsManagerSecretName } from '../secrets/secretsManager.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/**
 * What SST needs to create a stack is most of AWS, so this is the default
 * outside compose — said out loud in the output, and replaceable with
 * `--policy-arn`.
 */
export const DEFAULT_POLICY_ARN = 'arn:aws:iam::aws:policy/AdministratorAccess';

/** The name of the inline policy a compose stage's role is given. */
export const SCOPED_POLICY_NAME = 'gkm-deploy';

/** One statement of an IAM policy document. */
export interface PolicyStatement {
	Sid: string;
	Effect: 'Allow';
	Action: string[];
	Resource: string | string[];
	Condition?: Record<string, Record<string, string>>;
}

/** What the role is given. */
export type DeployAccess =
	| {
			kind: 'managed';
			policyArn: string;
			/** Why, for the output. */
			reason: string;
	  }
	| {
			kind: 'scoped';
			/** The statements, in the account the role is in. */
			statements(account: string): PolicyStatement[];
			/** What each statement is for, for the output. */
			describe: string[];
	  };

/** Every target the stage's apps deploy through. */
export function deployTargets(workspace: NormalizedWorkspace): string[] {
	const targets = new Set<string>([workspace.deploy?.default ?? 'dokploy']);
	for (const app of Object.values(workspace.apps)) {
		targets.add(app.resolvedDeployTarget);
	}
	return [...targets].sort();
}

/**
 * The access the stage's deploy role is given: `--policy-arn` when passed,
 * the scoped policy for a stage only the compose target deploys, and
 * `AdministratorAccess` otherwise.
 */
export function deployAccess(
	workspace: NormalizedWorkspace,
	stage: string,
	policyArn?: string,
): DeployAccess {
	if (policyArn) {
		return { kind: 'managed', policyArn, reason: '--policy-arn' };
	}

	const targets = deployTargets(workspace);
	if (targets.length !== 1 || targets[0] !== 'compose') {
		return {
			kind: 'managed',
			policyArn: DEFAULT_POLICY_ARN,
			reason: `the ${targets.join(', ')} target${targets.length === 1 ? '' : 's'} deploy${targets.length === 1 ? 's' : ''} infrastructure; --policy-arn to narrow`,
		};
	}

	const project = workspace.name;
	const store = workspace.secrets.store ?? 'file';
	const state = workspace.state;
	const custom =
		(typeof store === 'object' && typeof store.provider === 'object') ||
		(state !== undefined && typeof state.provider === 'object');
	if (custom) {
		return {
			kind: 'managed',
			policyArn: DEFAULT_POLICY_ARN,
			reason: `a custom ${typeof store === 'object' && typeof store.provider === 'object' ? 'secrets store' : 'state provider'} cannot be scoped; --policy-arn to narrow`,
		};
	}

	const describe: string[] = [];
	const build: ((account: string) => PolicyStatement[])[] = [];

	if (typeof store === 'object' && store.provider === 'ssm') {
		const { region } = store;
		const name = secretsParameterName(project, stage);
		describe.push(`read and update ${name} (SSM, ${region})`);
		build.push((account) => [
			{
				Sid: 'StageSecrets',
				Effect: 'Allow',
				Action: ['ssm:GetParameter', 'ssm:PutParameter'],
				Resource: `arn:aws:ssm:${region}:${account}:parameter${name}`,
			},
		]);
	} else if (
		typeof store === 'object' &&
		store.provider === 'secrets-manager'
	) {
		const { region, kmsKeyId } = store as { region: string; kmsKeyId?: string };
		const name = secretsManagerSecretName(project, stage);
		describe.push(`read and update ${name} (Secrets Manager, ${region})`);
		build.push((account) => {
			const statements: PolicyStatement[] = [
				{
					Sid: 'StageSecrets',
					Effect: 'Allow',
					Action: [
						'secretsmanager:GetSecretValue',
						'secretsmanager:PutSecretValue',
						'secretsmanager:CreateSecret',
					],
					// Secrets Manager appends six random characters to a secret's ARN.
					Resource: `arn:aws:secretsmanager:${region}:${account}:secret:${name}-??????`,
				},
			];
			if (kmsKeyId) {
				statements.push({
					Sid: 'StageSecretsKey',
					Effect: 'Allow',
					Action: ['kms:Decrypt', 'kms:GenerateDataKey'],
					Resource: kmsKeyId.startsWith('arn:') ? kmsKeyId : '*',
					Condition: {
						StringEquals: {
							'kms:ViaService': `secretsmanager.${region}.amazonaws.com`,
						},
					},
				});
			}
			return statements;
		});
	}

	if (state?.provider === 'ssm') {
		const { region } = state;
		const path = `/gkm/${project}/${stage}/`;
		describe.push(
			`read and write the deploy state under ${path} (SSM, ${region})`,
		);
		build.push((account) => [
			{
				Sid: 'StageState',
				Effect: 'Allow',
				Action: ['ssm:GetParameter', 'ssm:PutParameter', 'ssm:DeleteParameter'],
				Resource: `arn:aws:ssm:${region}:${account}:parameter${path}*`,
			},
		]);
	} else if (state?.provider === 's3') {
		const prefix = (state.prefix ?? 'gkm').replace(/\/+$/, '');
		const path = `${prefix ? `${prefix}/` : ''}${project}/${stage}/`;
		describe.push(
			`read and write the deploy state under s3://${state.bucket}/${path}`,
		);
		build.push(() => [
			{
				Sid: 'StageState',
				Effect: 'Allow',
				Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
				Resource: `arn:aws:s3:::${state.bucket}/${path}*`,
			},
			// So a state not written yet is a 404, not a 403.
			{
				Sid: 'StageStateBucket',
				Effect: 'Allow',
				Action: ['s3:ListBucket'],
				Resource: `arn:aws:s3:::${state.bucket}`,
			},
		]);
	}

	return {
		kind: 'scoped',
		statements: (account) => build.flatMap((statements) => statements(account)),
		describe,
	};
}

/** The scoped access as a policy document, or null when it allows nothing. */
export function scopedPolicyDocument(
	statements: PolicyStatement[],
): string | null {
	if (statements.length === 0) return null;
	return JSON.stringify({ Version: '2012-10-17', Statement: statements });
}

/** The account an IAM ARN is in: `arn:aws:iam::<account>:…`. */
export function accountOf(arn: string): string {
	return arn.split(':')[4] ?? '';
}
