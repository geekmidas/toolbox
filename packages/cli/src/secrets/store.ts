/**
 * Where a stage's secrets live when they are not only on one machine.
 *
 * A deployed stage has to reach its secrets from wherever it is deployed from
 * — a teammate's laptop today, a CI runner tomorrow — and `.gkm/` is not
 * committed, so the encrypted file on the machine that created them is not a
 * home for them. A store is: `push` puts a stage's secrets there, `pull`
 * brings them back, and the deploy reads the local copy `pull` writes.
 *
 * The same shape deploy state has (`StateProvider`): one interface, a backend
 * per place, and a custom object for any place this package does not ship.
 */

import type { NormalizedWorkspace } from '../workspace/types.js';
import { readStageSecrets, writeStageSecrets } from './storage.js';
import type { StageSecrets } from './types.js';

export interface SecretsStore {
	/** The stage's secrets, or null if the store holds none for it. */
	pull(stage: string): Promise<StageSecrets | null>;
	/** Replace the stage's secrets in the store. */
	push(stage: string, secrets: StageSecrets): Promise<void>;
}

/** Secrets in SSM Parameter Store, in the account of the active credentials. */
export interface SsmSecretsStoreConfig {
	provider: 'ssm';
	region: string;
}

/** Any other backend: an object implementing {@link SecretsStore}. */
export interface CustomSecretsStoreConfig {
	provider: SecretsStore;
}

/**
 * `secrets.store` in gkm.config.ts.
 *
 * `'file'` — the default — keeps each stage's secrets in the encrypted
 * `.gkm/secrets/<stage>.json` beside its key in `~/.gkm/`. It cannot serve a
 * deploy from CI while `.gkm/` is gitignored; `ssm` or a custom store can.
 */
export type SecretsStoreConfig =
	| 'file'
	| SsmSecretsStoreConfig
	| CustomSecretsStoreConfig;

/** The encrypted file under `.gkm/secrets/`, and its key under `~/.gkm/`. */
export class FileSecretsStore implements SecretsStore {
	constructor(private readonly root: string) {}

	pull(stage: string): Promise<StageSecrets | null> {
		return readStageSecrets(stage, this.root);
	}

	push(_stage: string, secrets: StageSecrets): Promise<void> {
		return writeStageSecrets(secrets, this.root);
	}
}

export interface SecretsStoreOptions {
	/**
	 * The AWS profile for the stage's account. Only that profile is used —
	 * never AWS_* from the environment — so a store cannot quietly land in
	 * whichever account the shell was exported for.
	 */
	profile?: string;
}

/**
 * The store a stage's secrets live in.
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
		return new FileSecretsStore(workspace.root);
	}

	if (configured.provider !== 'ssm') {
		return configured.provider;
	}

	const { SsmSecretsStore } = await import('./ssm.js');
	return new SsmSecretsStore({
		project: workspace.name,
		region: configured.region,
		...(options.profile ? { profile: options.profile } : {}),
	});
}

/** Whether a stage's secrets live somewhere other than this machine. */
export function isRemoteStore(
	workspace: NormalizedWorkspace,
	stage: string,
): boolean {
	const configured = workspace.secrets.store ?? 'file';
	return stage !== workspace.stages.local && configured !== 'file';
}
