/**
 * A stage's secrets in SSM Parameter Store, in the stage's own AWS account.
 *
 * One parameter per stage, `/gkm/<project>/<stage>/secrets`, a SecureString —
 * encrypted at rest by KMS, so nothing about it needs a key file anywhere.
 * Which account it is in is whichever credentials are active: the stage's
 * OIDC role in a deploy job, or `--profile` on a developer's machine. With
 * staging and production in different accounts, each stage's secrets sit
 * beside its infrastructure, and a staging role cannot read production's.
 */

import {
	GetParameterCommand,
	ParameterNotFound,
	PutParameterCommand,
	SSMClient,
	type SSMClientConfig,
} from '@aws-sdk/client-ssm';
import type { SecretsStore } from './store.js';
import type { StageSecrets } from './types.js';

export interface AwsSecretsStoreOptions {
	/** The workspace name, which scopes the parameter path. */
	project: string;
	region: string;
	/**
	 * A named AWS profile, resolved with `fromIni` only. The default chain
	 * reads AWS_* from the environment first, so exported staging keys would
	 * win over `--profile prod` and put production's secrets in staging.
	 */
	profile?: string;
	/** For tests: an endpoint such as the AWS emulator. */
	endpoint?: string;
}

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

		const config: SSMClientConfig = { region: this.options.region };
		if (this.options.profile) {
			const { fromIni } = await import('@aws-sdk/credential-providers');
			config.credentials = fromIni({ profile: this.options.profile });
		}
		if (this.options.endpoint) {
			config.endpoint = this.options.endpoint;
		}

		this.client = new SSMClient(config);
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
		const ssm = await this.ssm();

		await ssm.send(
			new PutParameterCommand({
				Name: secretsParameterName(this.options.project, stage),
				Value: JSON.stringify(secrets),
				Type: 'SecureString',
				Overwrite: true,
				Description: `gkm secrets for ${this.options.project}/${stage}`,
			}),
		);
	}
}
