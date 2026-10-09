/**
 * `gkm secrets:migrate` — copy a deployed stage's secrets from the store
 * `secrets.store` names to another one, whole: service passwords, URLs and
 * custom keys alike, so nothing is regenerated and running services keep
 * their credentials.
 *
 * It copies and nothing more. The source is left as it was, and gkm.config.ts
 * is not edited: pointing `secrets.store` at the new store is the switch, and
 * the old copy is deleted by hand once deploys read from the new one.
 */

import { loadWorkspaceSettings } from '../config.js';
import { GkmError } from '../errors';
import { assertDeployedStage } from '../workspace/stages.js';
import {
	SECRETS_STORE_PROVIDERS,
	type SecretsStoreConfig,
	type SecretsStoreOptions,
	type SecretsStoreProvider,
	secretsStoreFor,
	storeFromConfig,
	UnknownSecretsStoreProvider,
} from './store.js';

const logger = console;

export interface SecretsMigrateOptions {
	stage: string;
	/** The store to copy to: `'file'`, `'ssm'` or `'secrets-manager'`. */
	to: string;
	/** The target's AWS region; defaults to the configured store's. */
	region?: string;
	/** Overwrite a stage the target already holds. */
	force?: boolean;
	/** The AWS profile for the stage's account, for both stores. */
	profile?: string;
}

/** An AWS store to copy to, with no region given and none configured. */
export class MigrateTargetNeedsRegion extends GkmError {
	constructor(readonly to: string) {
		super(
			`Copying to ${to} needs a region, and secrets.store has none to reuse. ` +
				`Pass it: gkm secrets:migrate --to ${to} --region <region> --stage <stage>.`,
		);
		this.name = 'MigrateTargetNeedsRegion';
	}
}

/** The target is the store the stage is already read from. */
export class MigrateTargetIsSource extends GkmError {
	constructor(
		readonly stage: string,
		readonly to: string,
	) {
		super(
			`Stage "${stage}" is already kept in ${to}, so there is nothing to copy. ` +
				'Name a different store with --to, or a different region with --region.',
		);
		this.name = 'MigrateTargetIsSource';
	}
}

/** The configured store holds nothing for the stage. */
export class NoSecretsToMigrate extends GkmError {
	constructor(
		readonly stage: string,
		readonly store: string,
	) {
		super(
			`The ${store} store holds no secrets for stage "${stage}", so there is nothing to copy. ` +
				`Check secrets.store in gkm.config.ts still names the store the stage is in, ` +
				`or create the stage there with gkm secrets:init --stage ${stage}.`,
		);
		this.name = 'NoSecretsToMigrate';
	}
}

/** The target already holds the stage, and `--force` was not given. */
export class MigrateTargetHoldsStage extends GkmError {
	constructor(
		readonly stage: string,
		readonly to: string,
	) {
		super(
			`The ${to} store already holds secrets for stage "${stage}". ` +
				'Pass --force to replace them with the ones being copied.',
		);
		this.name = 'MigrateTargetHoldsStage';
	}
}

/** The store a `--to` name and region describe. */
function targetConfig(
	to: string,
	region: string | undefined,
	configured: SecretsStoreConfig,
): SecretsStoreConfig {
	if (!(SECRETS_STORE_PROVIDERS as readonly string[]).includes(to)) {
		throw new UnknownSecretsStoreProvider(to);
	}
	const provider = to as SecretsStoreProvider;
	if (provider === 'file') return 'file';

	const fallback =
		typeof configured === 'object' && 'region' in configured
			? configured.region
			: undefined;
	const resolved = region ?? fallback;
	if (!resolved) throw new MigrateTargetNeedsRegion(provider);
	return { provider, region: resolved };
}

export async function secretsMigrateCommand(
	options: SecretsMigrateOptions,
): Promise<void> {
	const { stage, to } = options;
	const workspace = await loadWorkspaceSettings();
	assertDeployedStage(workspace.stages, stage);

	const configured = workspace.secrets.store ?? 'file';
	const target = targetConfig(to, options.region, configured);
	const sameStore =
		typeof configured === 'string' || typeof target === 'string'
			? configured === target
			: configured.provider === target.provider &&
				'region' in configured &&
				'region' in target &&
				configured.region === target.region;
	if (sameStore) throw new MigrateTargetIsSource(stage, to);

	const storeOptions: SecretsStoreOptions = options.profile
		? { profile: options.profile }
		: {};
	const source = await secretsStoreFor(workspace, stage, storeOptions);
	const destination = await storeFromConfig(workspace, target, storeOptions);

	const secrets = await source.read(stage);
	if (!secrets) throw new NoSecretsToMigrate(stage, source.name);

	if (!options.force && (await destination.read(stage))) {
		throw new MigrateTargetHoldsStage(stage, destination.name);
	}

	await destination.write(stage, secrets);

	const shape =
		typeof target === 'object' && 'region' in target
			? `{ provider: '${target.provider}', region: '${target.region}' }`
			: `'file'`;
	logger.log(
		`\n✓ Copied the secrets for stage "${stage}" from ${source.name} to ${destination.name}`,
	);
	logger.log(
		`\n  Next: set secrets.store to ${shape} in gkm.config.ts, so commands and deploys read from ${destination.name}.`,
	);
	logger.log(
		`  The copy in ${source.name} is left as it was; delete it once deploys read from ${destination.name}.`,
	);
}
