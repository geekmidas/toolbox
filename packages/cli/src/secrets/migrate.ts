/**
 * `gkm secrets:migrate` — copy a deployed stage's secrets from the store
 * `secrets.store` names to another one, whole: service passwords, URLs and
 * custom keys alike, so nothing is regenerated and running services keep
 * their credentials.
 *
 * It copies, reads the copy back and compares it, and nothing more. The source
 * is never deleted, and gkm.config.ts is not edited: pointing `secrets.store`
 * at the new store is the switch, and the old copy is deleted by hand — with
 * the command this prints — once deploys read from the new one. Run again, a
 * target already holding the same secrets is verified and left alone.
 */

import { isDeepStrictEqual } from 'node:util';

import { loadWorkspaceSettings } from '../config.js';
import { GkmError } from '../errors';
import { assertDeployedStage } from '../workspace/stages.js';
import { secretsParameterName } from './aws.js';
import { secretsManagerSecretName } from './secretsManager.js';
import {
	SECRETS_STORE_PROVIDERS,
	type SecretsStore,
	type SecretsStoreConfig,
	type SecretsStoreOptions,
	type SecretsStoreProvider,
	s3SecretsLocation,
	secretsStoreFor,
	storeFromConfig,
	UnknownSecretsStoreProvider,
} from './store.js';
import type { StageSecrets } from './types.js';

const logger = console;

export interface SecretsMigrateOptions {
	stage: string;
	/** The store to copy to: `'file'`, `'s3'`, `'ssm'` or `'secrets-manager'`. */
	to: string;
	/**
	 * The target's AWS region; defaults to the configured store's — for `s3`,
	 * to the S3 state's first.
	 */
	region?: string;
	/** Overwrite a stage the target already holds different secrets for. */
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

/**
 * The target already holds different secrets for the stage, and `--force` was
 * not given.
 */
export class MigrateTargetHoldsStage extends GkmError {
	constructor(
		readonly stage: string,
		readonly to: string,
	) {
		super(
			`The ${to} store already holds different secrets for stage "${stage}". ` +
				'Pass --force to replace them with the ones being copied.',
		);
		this.name = 'MigrateTargetHoldsStage';
	}
}

/** The copy read back from the target is not what was copied. */
export class MigratedSecretsDiffer extends GkmError {
	constructor(
		readonly stage: string,
		readonly to: string,
		/** The keys whose values differ, or that only one side has. */
		readonly keys: readonly string[],
	) {
		super(
			`The secrets for stage "${stage}" read back from ${to} differ from the ones copied` +
				(keys.length ? ` (${keys.join(', ')})` : '') +
				'. The source is untouched and secrets.store still names it; run the migration again, ' +
				'or with --force if something else is writing to the target.',
		);
		this.name = 'MigratedSecretsDiffer';
	}
}

/** The region the configured store is in, where it is an AWS one. */
function configuredRegion(
	configured: SecretsStoreConfig,
	state: unknown,
): string | undefined {
	if (typeof configured !== 'object') return undefined;
	if (configured.provider === 's3') {
		return s3SecretsLocation(configured, state).region;
	}
	// A custom store has no region to reuse.
	return 'region' in configured ? configured.region : undefined;
}

/** The store a `--to` name and region describe. */
function targetConfig(
	to: string,
	region: string | undefined,
	configured: SecretsStoreConfig,
	state: unknown,
): SecretsStoreConfig {
	if (!(SECRETS_STORE_PROVIDERS as readonly string[]).includes(to)) {
		throw new UnknownSecretsStoreProvider(to);
	}
	const provider = to as SecretsStoreProvider;
	if (provider === 'file') return 'file';

	const fallback = configuredRegion(configured, state);

	if (provider === 's3') {
		// The project bucket beside an S3 state is in the state's region.
		const inherits =
			typeof state === 'object' &&
			state !== null &&
			(state as { provider?: unknown }).provider === 's3';
		const resolved = region ?? (inherits ? undefined : fallback);
		if (!resolved && !inherits) throw new MigrateTargetNeedsRegion(provider);
		return { provider, ...(resolved ? { region: resolved } : {}) };
	}

	const resolved = region ?? fallback;
	if (!resolved) throw new MigrateTargetNeedsRegion(provider);
	return { provider, region: resolved };
}

/** Whether two configs name the same place. */
function samePlace(
	a: SecretsStoreConfig,
	b: SecretsStoreConfig,
	state: unknown,
): boolean {
	if (typeof a === 'string' || typeof b === 'string') return a === b;
	if (a.provider !== b.provider) return false;
	if (a.provider === 's3' && b.provider === 's3') {
		return isDeepStrictEqual(
			s3SecretsLocation(a, state),
			s3SecretsLocation(b, state),
		);
	}
	return 'region' in a && 'region' in b && a.region === b.region;
}

/** The `secrets.store` value to write in gkm.config.ts. */
function configLine(target: SecretsStoreConfig): string {
	if (typeof target === 'string') return `'${target}'`;
	const region =
		'region' in target && target.region ? `, region: '${target.region}'` : '';
	return `{ provider: '${String(target.provider)}'${region} }`;
}

/** The keys whose values differ between two documents, as `section.KEY`. */
export function differingKeys(
	a: StageSecrets,
	b: StageSecrets | null,
): string[] {
	const keys: string[] = [];
	for (const section of ['custom', 'urls', 'services'] as const) {
		const left = a[section] as Record<string, unknown>;
		const right = (b?.[section] ?? {}) as Record<string, unknown>;
		for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
			if (!isDeepStrictEqual(left[key], right[key])) {
				keys.push(`${section}.${key}`);
			}
		}
	}
	return keys.sort();
}

/**
 * The command that deletes the stage's copy in the source store, for the
 * person to run once deploys read from the target — gkm never runs it.
 */
export function deleteSourceCommand(
	workspace: { name: string },
	configured: SecretsStoreConfig,
	source: SecretsStore,
	stage: string,
	profile: string | undefined,
): string | null {
	const as = profile ? ` --profile ${profile}` : '';
	if (configured === 'file') return `rm .gkm/secrets/${stage}.json`;
	switch (configured.provider) {
		case 'ssm':
			return `aws ssm delete-parameter --name ${secretsParameterName(workspace.name, stage)} --region ${configured.region}${as}`;
		case 'secrets-manager':
			return `aws secretsmanager delete-secret --secret-id ${secretsManagerSecretName(workspace.name, stage)} --region ${configured.region}${as}`;
		case 's3': {
			const location = (
				source as { location?(stage: string): string }
			).location?.(stage);
			if (!location) return null;
			// Every version, as the bucket keeps them: only a delete marker is added.
			return `aws s3 rm ${location}${as}`;
		}
		default:
			return null;
	}
}

export async function secretsMigrateCommand(
	options: SecretsMigrateOptions,
): Promise<void> {
	const { stage, to } = options;
	const workspace = await loadWorkspaceSettings();
	assertDeployedStage(workspace.stages, stage);

	const configured = workspace.secrets.store ?? 'file';
	const target = targetConfig(to, options.region, configured, workspace.state);
	if (samePlace(configured, target, workspace.state)) {
		throw new MigrateTargetIsSource(stage, to);
	}

	const storeOptions: SecretsStoreOptions = options.profile
		? { profile: options.profile }
		: {};
	const source = await secretsStoreFor(workspace, stage, storeOptions);
	const destination = await storeFromConfig(workspace, target, storeOptions);

	const secrets = await source.read(stage);
	if (!secrets) throw new NoSecretsToMigrate(stage, source.name);

	const held = await destination.read(stage);
	const already = held !== null && isDeepStrictEqual(held, secrets);
	if (held && !already && !options.force) {
		throw new MigrateTargetHoldsStage(stage, destination.name);
	}
	if (!already) await destination.write(stage, secrets);

	// Read back through a store of its own, so nothing cached answers.
	const copied = await (
		await storeFromConfig(workspace, target, storeOptions)
	).read(stage);
	if (!isDeepStrictEqual(copied, secrets)) {
		throw new MigratedSecretsDiffer(
			stage,
			destination.name,
			differingKeys(secrets, copied),
		);
	}

	const count =
		Object.keys(secrets.custom).length +
		Object.keys(secrets.urls).length +
		Object.keys(secrets.services).length;
	logger.log(
		already
			? `\n✓ ${destination.name} already holds the same secrets for stage "${stage}" as ${source.name}; nothing copied`
			: `\n✓ Copied the secrets for stage "${stage}" from ${source.name} to ${destination.name}`,
	);
	logger.log(
		`  Verified: ${count} keys read back from ${destination.name}, equal.`,
	);
	logger.log(
		`\n  Next: set secrets.store to ${configLine(target)} in gkm.config.ts, so commands and deploys read from ${destination.name}.`,
	);
	const remove = deleteSourceCommand(
		workspace,
		configured,
		source,
		stage,
		options.profile,
	);
	logger.log(
		`  The copy in ${source.name} is left as it was. Once deploys read from ${destination.name}, delete it` +
			(remove ? ` with:\n\n    ${remove}\n` : '.'),
	);
}
