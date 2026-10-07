/**
 * `gkm deploy --provider`, from before there were targets.
 *
 * It named three things, and only one of them ever deployed a workspace:
 * `dokploy` is now the target of that name; `docker` and `aws-lambda` were
 * accepted and always failed, so they are gone with a pointer to what does
 * the job.
 */

import { DeployTargetNotYetSupported } from './builtins';

/** What each removed provider's job is done with now. */
const REMOVED: Record<string, string> = {
	docker:
		'Build images with `gkm docker`, or run the stage as one Docker Compose stack with `gkm compose`',
	'aws-lambda':
		"Deploy to AWS with SST: set deploy: { default: 'sst' } and run `gkm build && sst deploy --stage <stage>`",
};

/** A `--provider` that no longer exists. */
export class ProviderRemoved extends Error {
	constructor(
		readonly provider: string,
		/** What to use instead. */
		readonly instead: string,
	) {
		super(`--provider ${provider} has been removed. ${instead}.`);
		this.name = 'ProviderRemoved';
	}
}

/** The deprecation `--provider` prints when it still means something. */
export function providerDeprecation(provider: string): string {
	return `--provider is deprecated; use --target ${provider}.`;
}

/**
 * The target a `--provider` value means. `warn` hears the deprecation; a
 * provider that is gone, or a target not deployable yet, throws.
 */
export function targetForProvider(
	provider: string,
	warn: (message: string) => void,
): string {
	const removed = REMOVED[provider];
	if (removed) throw new ProviderRemoved(provider, removed);
	if (provider === 'vercel' || provider === 'cloudflare') {
		throw new DeployTargetNotYetSupported(provider);
	}
	warn(providerDeprecation(provider));
	return provider;
}
