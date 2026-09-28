/**
 * Moving a deployed stage's secrets between this machine and its store.
 *
 * `push` sends the encrypted local copy to the stage's store; `pull` brings it
 * back and writes the local copy a deploy reads — generating a key for it if
 * the machine has none, which is what a fresh CI runner needs. Both reconcile
 * the keys the workspace now derives, so a store never lags a new construct.
 */

import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { reconcileMissingSecrets } from './reconcile.js';
import { readStageSecrets, writeStageSecrets } from './storage.js';
import {
	isRemoteStore,
	type SecretsStoreOptions,
	secretsStoreFor,
} from './store.js';
import type { StageSecrets } from './types.js';

export interface TransferResult {
	secrets: StageSecrets;
	/** Keys the workspace derives that the secrets were missing, now added. */
	addedKeys: string[];
}

/** A push or pull for a stage with nowhere to push or pull from. */
export class NoRemoteSecretsStore extends Error {
	constructor(readonly stage: string) {
		super(
			`Stage "${stage}" keeps its secrets in the local file, so there is nothing to push or pull. ` +
				"Set secrets.store in gkm.config.ts (e.g. { provider: 'ssm', region: 'eu-west-1' }) for deployed stages.",
		);
		this.name = 'NoRemoteSecretsStore';
	}
}

/** A push for a stage whose secrets this machine does not have. */
export class NoLocalSecrets extends Error {
	constructor(readonly stage: string) {
		super(
			`No secrets for stage "${stage}" on this machine. Run gkm secrets:init --stage ${stage} first.`,
		);
		this.name = 'NoLocalSecrets';
	}
}

/** A pull for a stage the store holds nothing for. */
export class NoStoredSecrets extends Error {
	constructor(readonly stage: string) {
		super(
			`The store holds no secrets for stage "${stage}". Push them first: gkm secrets:push --stage ${stage}.`,
		);
		this.name = 'NoStoredSecrets';
	}
}

async function reconcile(
	secrets: StageSecrets,
	workspace: NormalizedWorkspace,
	stage: string,
): Promise<TransferResult> {
	const { derivedContainers } = await import('../reconcile/workspace.js');
	const result = reconcileMissingSecrets(
		secrets,
		workspace,
		await derivedContainers(workspace, stage),
	);
	return result
		? { secrets: result.secrets, addedKeys: result.addedKeys }
		: { secrets, addedKeys: [] };
}

function remoteOnly(workspace: NormalizedWorkspace, stage: string): void {
	assertDeployedStage(workspace.stages, stage);
	if (!isRemoteStore(workspace, stage)) throw new NoRemoteSecretsStore(stage);
}

/** Send this machine's secrets for a deployed stage to its store. */
export async function pushStageSecrets(
	workspace: NormalizedWorkspace,
	stage: string,
	options: SecretsStoreOptions = {},
): Promise<TransferResult> {
	remoteOnly(workspace, stage);

	const local = await readStageSecrets(stage, workspace.root);
	if (!local) throw new NoLocalSecrets(stage);

	const result = await reconcile(local, workspace, stage);
	if (result.addedKeys.length) {
		await writeStageSecrets(result.secrets, workspace.root);
	}

	const store = await secretsStoreFor(workspace, stage, options);
	await store.push(stage, result.secrets);
	return result;
}

/** Bring a deployed stage's secrets from its store into the local copy. */
export async function pullStageSecrets(
	workspace: NormalizedWorkspace,
	stage: string,
	options: SecretsStoreOptions = {},
): Promise<TransferResult> {
	remoteOnly(workspace, stage);

	const store = await secretsStoreFor(workspace, stage, options);
	const stored = await store.pull(stage);
	if (!stored) throw new NoStoredSecrets(stage);

	const result = await reconcile(stored, workspace, stage);
	await writeStageSecrets(result.secrets, workspace.root);
	return result;
}
