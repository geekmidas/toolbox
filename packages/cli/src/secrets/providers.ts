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
				`Use 'file', { provider: 'ssm', region }, { provider: 'secrets-manager', region }, ` +
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
