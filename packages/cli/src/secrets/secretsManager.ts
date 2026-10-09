/**
 * A stage's secrets in AWS Secrets Manager, in the stage's own AWS account.
 *
 * One secret per stage, `gkm/<project>/<stage>/secrets` — the SSM store's
 * parameter name without its leading `/` — holding the same JSON. It is
 * encrypted with the account's `aws/secretsmanager` key unless `kmsKeyId`
 * names another. Which account it is in is whichever credentials are active,
 * exactly as for the SSM store.
 *
 * Chosen over SSM for size (64 KB rather than 8 KB) and for Secrets Manager's
 * own versioning, at a monthly price per secret.
 */

import {
	CreateSecretCommand,
	GetSecretValueCommand,
	PutSecretValueCommand,
	ResourceNotFoundException,
	SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
	type AwsStoreOptions,
	awsClientConfig,
	serializeWithin,
	withStageCredentials,
} from './awsStore.js';
import type { SecretsStore } from './store.js';
import type { StageSecrets } from './types.js';

export interface SecretsManagerStoreOptions extends AwsStoreOptions {
	/** The KMS key a new secret is encrypted with; `aws/secretsmanager` if unset. */
	kmsKeyId?: string;
}

/** The most a Secrets Manager secret holds: 64 KB. */
export const SECRETS_MANAGER_SECRET_LIMIT = 64 * 1024;

/** The secret a stage's secrets are kept in. */
export function secretsManagerSecretName(
	project: string,
	stage: string,
): string {
	return `gkm/${project}/${stage}/secrets`;
}

export class SecretsManagerSecretsStore implements SecretsStore {
	readonly name = 'secrets-manager';

	private client?: SecretsManagerClient;

	constructor(private readonly options: SecretsManagerStoreOptions) {}

	private async secretsManager(): Promise<SecretsManagerClient> {
		if (this.client) return this.client;
		this.client = new SecretsManagerClient(await awsClientConfig(this.options));
		return this.client;
	}

	private secretName(stage: string): string {
		return secretsManagerSecretName(this.options.project, stage);
	}

	/** Where a call for `stage` is, for an error saying it has no credentials. */
	private context(stage: string, access: 'read' | 'write') {
		return { stage, store: this.name, profile: this.options.profile, access };
	}

	/**
	 * @throws {StageSecretsUnreadable} when there are no AWS credentials to
	 * read it with, or they have expired
	 */
	async read(stage: string): Promise<StageSecrets | null> {
		const client = await this.secretsManager();

		try {
			const { SecretString } = await withStageCredentials(
				this.context(stage, 'read'),
				() =>
					client.send(
						new GetSecretValueCommand({ SecretId: this.secretName(stage) }),
					),
			);
			return SecretString ? (JSON.parse(SecretString) as StageSecrets) : null;
		} catch (error) {
			if (error instanceof ResourceNotFoundException) return null;
			throw error;
		}
	}

	/**
	 * @throws {StageSecretsUnreadable} when there are no AWS credentials to
	 * write it with, or they have expired
	 */
	async write(stage: string, secrets: StageSecrets): Promise<void> {
		const value = serializeWithin(
			stage,
			this.name,
			secrets,
			SECRETS_MANAGER_SECRET_LIMIT,
		);
		const client = await this.secretsManager();
		const name = this.secretName(stage);

		await withStageCredentials(this.context(stage, 'write'), () =>
			this.put(client, stage, name, value),
		);
	}

	/** Put the secret, creating it on the stage's first write. */
	private async put(
		client: SecretsManagerClient,
		stage: string,
		name: string,
		value: string,
	): Promise<void> {
		try {
			await client.send(
				new PutSecretValueCommand({ SecretId: name, SecretString: value }),
			);
		} catch (error) {
			if (!(error instanceof ResourceNotFoundException)) throw error;
			// The stage's first write: the secret does not exist yet.
			await client.send(
				new CreateSecretCommand({
					Name: name,
					SecretString: value,
					Description: `gkm secrets for ${this.options.project}/${stage}`,
					...(this.options.kmsKeyId ? { KmsKeyId: this.options.kmsKeyId } : {}),
				}),
			);
		}
	}
}
