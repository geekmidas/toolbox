/**
 * The secrets stores gkm ships, by name — with no imports, so the config
 * loader can check `secrets.store` without loading any store.
 */

import { GkmError } from '../errors';

/** The stores this package ships, by the name `secrets.store` gives them. */
export const SECRETS_STORE_PROVIDERS = [
	'file',
	'ssm',
	'secrets-manager',
	's3',
] as const;

export type SecretsStoreProvider = (typeof SECRETS_STORE_PROVIDERS)[number];

/**
 * `secrets.store` names a provider this package does not ship — a typo such
 * as `'secretsmanager'` or `'ssm-parameter'`. Refused rather than read as the
 * file, which would leave a deployed stage's secrets on one machine.
 */
export class UnknownSecretsStoreProvider extends GkmError {
	constructor(readonly provider: unknown) {
		super(
			`secrets.store names the provider ${JSON.stringify(provider)}, which is not one gkm ships. ` +
				`Use 'file', { provider: 's3' }, { provider: 'ssm', region }, { provider: 'secrets-manager', region }, ` +
				'or { provider: <an object with name, read() and write()> } in gkm.config.ts.',
		);
		this.name = 'UnknownSecretsStoreProvider';
	}
}

/**
 * Refuse a `secrets.store` naming a provider that is not one, before the
 * schema reduces it to a generic validation failure.
 */
export function assertKnownSecretsStore(store: unknown): void {
	if (store === undefined) return;
	const provider =
		typeof store === 'object' && store !== null && 'provider' in store
			? (store as { provider: unknown }).provider
			: store;
	if (
		typeof provider === 'string' &&
		!(SECRETS_STORE_PROVIDERS as readonly string[]).includes(provider)
	) {
		throw new UnknownSecretsStoreProvider(provider);
	}
}

/** What a `{ provider: 's3' }` store says, before defaults. */
export interface S3SecretsLocationConfig {
	provider: 's3';
	bucket?: string;
	region?: string;
	prefix?: string;
}

/** Where an `s3` store keeps each stage, its defaults filled in. */
export interface S3SecretsLocation {
	/** The bucket named; undefined for the project bucket. */
	bucket: string | undefined;
	region: string;
	/** Key prefix, without a trailing slash; `gkm` by default. */
	prefix: string;
}

/**
 * An `s3` secrets store names no region, and the deploy state is not in S3 to
 * take one from.
 */
export class S3SecretsStoreNeedsRegion extends GkmError {
	constructor() {
		super(
			"secrets.store is { provider: 's3' } with no region, and the deploy state is not in S3 " +
				"to take one from. Name it — secrets: { store: { provider: 's3', region: '<region>' } } — " +
				"or keep the state beside it: state: { provider: 's3', region: '<region>' }.",
		);
		this.name = 'S3SecretsStoreNeedsRegion';
	}
}

/**
 * Where an `s3` store keeps a stage's secrets. With no bucket named it is the
 * project bucket, beside the deploy state; region and prefix default to the
 * state's when that is in S3 too, so the two are written once.
 *
 * @throws {S3SecretsStoreNeedsRegion} when no region is named or inherited
 */
export function s3SecretsLocation(
	store: S3SecretsLocationConfig,
	state: unknown,
): S3SecretsLocation {
	const s3State =
		typeof state === 'object' &&
		state !== null &&
		(state as { provider?: unknown }).provider === 's3'
			? (state as { region?: string; prefix?: string })
			: undefined;
	const region = store.region ?? s3State?.region;
	if (!region) throw new S3SecretsStoreNeedsRegion();
	return {
		bucket: store.bucket,
		region,
		prefix: (store.prefix ?? s3State?.prefix ?? 'gkm').replace(/\/+$/, ''),
	};
}

/** The key a stage's secrets are kept at: `<prefix>/<project>/<stage>/secrets.json`. */
export function s3SecretsKey(
	prefix: string,
	project: string,
	stage: string,
): string {
	const path = `${project}/${stage}/secrets.json`;
	return prefix ? `${prefix}/${path}` : path;
}
