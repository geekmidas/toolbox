/**
 * A stage's secrets in SSM Parameter Store, in the stage's own AWS account.
 *
 * One parameter per stage, `/gkm/<project>/<stage>/secrets`, a SecureString —
 * encrypted at rest by KMS, so nothing about it needs a key file anywhere.
 * Which account it is in is whichever credentials are active: the stage's
 * OIDC role in a deploy job, or `--profile` on a developer's machine. With
 * staging and production in different accounts, each stage's secrets sit
 * beside its infrastructure, and a staging role cannot read production's.
 *
 * Written in the Intelligent-Tiering tier: a stage under 4 KB stays a free
 * standard parameter, a larger one becomes advanced (up to 8 KB). Past 8 KB
 * the write is refused with {@link StageSecretsTooLarge} before AWS is
 * called; Secrets Manager (`secretsManager.ts`) holds up to 64 KB.
 */

import {
	GetParameterCommand,
	ParameterNotFound,
	PutParameterCommand,
	SSMClient,
} from '@aws-sdk/client-ssm';
import {
	type AwsStoreOptions,
	awsClientConfig,
	serializeWithin,
} from './awsStore.js';
import type { SecretsStore } from './store.js';
import type { StageSecrets } from './types.js';

export type AwsSecretsStoreOptions = AwsStoreOptions;

/** The most an SSM parameter holds: 8 KB, in the advanced tier. */
export const SSM_PARAMETER_LIMIT = 8 * 1024;

/** The parameter a stage's secrets are kept in. */
export function secretsParameterName(project: string, stage: string): string {
	return `/gkm/${project}/${stage}/secrets`;
}

export class AwsSecretsStore implements SecretsStore {
	readonly name = 'ssm';

	private client?: SSMClient;

	constructor(private readonly options: AwsSecretsStoreOptions) {}

	private async ssm(): Promise<SSMClient> {
		if (this.client) return this.client;

		this.client = new SSMClient(await awsClientConfig(this.options));
		return this.client;
	}

	async read(stage: string): Promise<StageSecrets | null> {
		const ssm = await this.ssm();

		try {
			const { Parameter } = await ssm.send(
				new GetParameterCommand({
					Name: secretsParameterName(this.options.project, stage),
					WithDecryption: true,
				}),
			);
			return Parameter?.Value
				? (JSON.parse(Parameter.Value) as StageSecrets)
				: null;
		} catch (error) {
			if (error instanceof ParameterNotFound) return null;
			throw error;
		}
	}

	async write(stage: string, secrets: StageSecrets): Promise<void> {
		const value = serializeWithin(
			stage,
			this.name,
			secrets,
			SSM_PARAMETER_LIMIT,
		);
		const ssm = await this.ssm();

		await ssm.send(
			new PutParameterCommand({
				Name: secretsParameterName(this.options.project, stage),
				Value: value,
				Type: 'SecureString',
				// Standard (free) under 4 KB, advanced past it; never the other way.
				Tier: 'Intelligent-Tiering',
				Overwrite: true,
				Description: `gkm secrets for ${this.options.project}/${stage}`,
			}),
		);
	}
}
