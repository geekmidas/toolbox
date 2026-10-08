/**
 * Where a stage's secrets are kept.
 *
 * Every command that needs a stage's secrets — `gkm dev`, `test`, `deploy`,
 * `build`, `setup`, `secrets:*` — asks {@link secretsStoreFor} for that
 * stage's store and reads or writes it. None of them knows whether that is a
 * file on this machine, SSM or Secrets Manager in the stage's account: the local stage is
 * always the file, and a deployed stage is whatever `secrets.store` names.
 *
 * The same shape deploy state has (`StateProvider`): one interface, a backend
 * per place, and a custom object for any place this package does not ship.
 */

import type { NormalizedWorkspace } from '../workspace/types.js';
import { FileSecretsStore } from './file.js';
import { keystoreProject } from './keystore.js';
import { UnknownSecretsStoreProvider } from './providers.js';
import type { StageSecrets } from './types.js';

export interface SecretsStore {
	/**
	 * Which kind of store this is — `'file'`, `'ssm'`, `'secrets-manager'`, or
	 * a custom one's.
	 */
	readonly name: string;
	/** The stage's secrets, or null when it has none here. */
	read(stage: string): Promise<StageSecrets | null>;
	/** Replace the stage's secrets. */
	write(stage: string, secrets: StageSecrets): Promise<void>;
}

/** Secrets in SSM Parameter Store, in the account of the active credentials. */
export interface SsmSecretsStoreConfig {
	provider: 'ssm';
	region: string;
}

/**
 * Secrets in AWS Secrets Manager, in the account of the active credentials:
 * one secret per stage, `gkm/<project>/<stage>/secrets`. Up to 64 KB where
 * SSM holds 8 KB, at a monthly price per secret.
 */
export interface SecretsManagerSecretsStoreConfig {
	provider: 'secrets-manager';
	region: string;
	/**
	 * The KMS key (id, ARN or alias) a stage's secret is created with. Unset,
	 * it is the account's AWS-managed `aws/secretsmanager` key.
	 */
	kmsKeyId?: string;
}

/** Any other backend: an object implementing {@link SecretsStore}. */
export interface CustomSecretsStoreConfig {
	provider: SecretsStore;
}

/**
 * `secrets.store` in gkm.config.ts.
 *
 * `'file'` — the default — keeps each stage's secrets in the encrypted
 * `.gkm/secrets/<stage>.json`, its key in the CLI's home (`GKM_HOME`, else
 * `~/.gkm`). It cannot serve a
 * deploy from CI while `.gkm/` is gitignored; `ssm`, `secrets-manager` or a
 * custom store can.
 */
export type SecretsStoreConfig =
	| 'file'
	| SsmSecretsStoreConfig
	| SecretsManagerSecretsStoreConfig
	| CustomSecretsStoreConfig;

export interface SecretsStoreOptions {
	/**
	 * The AWS profile for the stage's account. Only that profile is used —
	 * never AWS_* from the environment — so a store cannot quietly land in
	 * whichever account the shell was exported for.
	 */
	profile?: string;
	/**
	 * The CLI's home, where a file store's keys are kept. Defaults to
	 * `GKM_HOME`, else `~/.gkm`.
	 */
	home?: string;
}

/**
 * The store a stage's secrets are kept in — what every command reads and
 * writes, for the stage it acts on.
 *
 * The local stage is always the file: its secrets belong to the machine
 * running `gkm dev`. A deployed stage uses `secrets.store`.
 */
export async function secretsStoreFor(
	workspace: NormalizedWorkspace,
	stage: string,
	options: SecretsStoreOptions = {},
): Promise<SecretsStore> {
	const configured = workspace.secrets.store ?? 'file';

	if (stage === workspace.stages.local || configured === 'file') {
		return new FileSecretsStore(
			workspace.root,
			keystoreProject(workspace, options.home),
		);
	}

	return storeFromConfig(workspace, configured, options);
}

/**
 * The store a `secrets.store` value describes, for any stage — what
 * {@link secretsStoreFor} answers for a deployed stage, and what
 * `gkm secrets:migrate` builds for the store it copies to.
 */
export async function storeFromConfig(
	workspace: NormalizedWorkspace,
	config: SecretsStoreConfig,
	options: SecretsStoreOptions = {},
): Promise<SecretsStore> {
	if (config === 'file') {
		return new FileSecretsStore(
			workspace.root,
			keystoreProject(workspace, options.home),
		);
	}

	const profile = options.profile ? { profile: options.profile } : {};

	switch (config.provider) {
		case 'ssm': {
			const { AwsSecretsStore } = await import('./aws.js');
			return new AwsSecretsStore({
				project: workspace.name,
				region: config.region,
				...profile,
			});
		}
		case 'secrets-manager': {
			const { kmsKeyId } = config as SecretsManagerSecretsStoreConfig;
			const { SecretsManagerSecretsStore } = await import(
				'./secretsManager.js'
			);
			return new SecretsManagerSecretsStore({
				project: workspace.name,
				region: config.region,
				...(kmsKeyId ? { kmsKeyId } : {}),
				...profile,
			});
		}
		default: {
			// Typed as a SecretsStore, but a config assembled by hand may name
			// a provider that is not one.
			const provider: unknown = config.provider;
			if (typeof provider === 'object' && provider !== null) {
				return provider as SecretsStore;
			}
			throw new UnknownSecretsStoreProvider(provider);
		}
	}
}

/** Whether a stage's secrets live somewhere other than this machine. */
export function isRemoteStore(
	workspace: NormalizedWorkspace,
	stage: string,
): boolean {
	const configured = workspace.secrets.store ?? 'file';
	return stage !== workspace.stages.local && configured !== 'file';
}

export { FileSecretsStore };
export {
	assertKnownSecretsStore,
	SECRETS_STORE_PROVIDERS,
	type SecretsStoreProvider,
	UnknownSecretsStoreProvider,
} from './providers.js';
