/**
 * The DNS provider a `dns` domain names, built from the workspace's config.
 *
 * The providers themselves are `@geekmidas/edge`'s and take their credentials
 * as given. Where a credential comes from (a stored login, the environment)
 * and what to say when there is none are the CLI's, and are decided here.
 */

import { type DnsProvider, isDnsProvider } from '@geekmidas/edge/dns';
import type {
	GoDaddyCredential,
	GoDaddyProviderOptions,
} from '@geekmidas/edge/dns/godaddy';
import type { HostingerCredential } from '@geekmidas/edge/dns/hostinger';
import type { z } from 'zod/v4';
import { getHostingerToken } from '../auth/credentials';
import { MissingCredential, storedCredentials } from '../deploy/credentials';
import { GkmError } from '../errors';
import type {
	CloudflareDnsProviderSchema,
	CustomDnsProviderSchema,
	DnsProviderSchema,
	GoDaddyDnsProviderSchema,
	HostingerDnsProviderSchema,
	ManualDnsProviderSchema,
	Route53DnsProviderSchema,
} from '../workspace/schema';

export type HostingerDnsConfig = z.infer<typeof HostingerDnsProviderSchema>;
export type Route53DnsConfig = z.infer<typeof Route53DnsProviderSchema>;
export type GoDaddyDnsConfig = z.infer<typeof GoDaddyDnsProviderSchema>;
export type CloudflareDnsConfig = z.infer<typeof CloudflareDnsProviderSchema>;
export type ManualDnsConfig = z.infer<typeof ManualDnsProviderSchema>;
export type CustomDnsConfig = z.infer<typeof CustomDnsProviderSchema>;
/** Single DNS provider config (for one domain) */
export type DnsConfig = z.infer<typeof DnsProviderSchema>;

/**
 * The GoDaddy provider's options as the CLI takes them: its token as given,
 * or else read from the environment (`env`) or the CLI's home (`home`).
 */
export type GoDaddyOptions = Omit<GoDaddyProviderOptions, 'credential'> & {
	credential?: GoDaddyCredential;
	env?: NodeJS.ProcessEnv;
	home?: string;
};

export interface CreateDnsProviderOptions {
	/** DNS config from workspace */
	config: DnsConfig;
	/**
	 * The GoDaddy provider's options. Its token is the one given, or else the
	 * one stored or in the environment (`env`, the CLI's `home`), read the
	 * first time the API is called.
	 */
	godaddy?: GoDaddyOptions;
	/** The Hostinger token, when the caller already has it. */
	hostinger?: HostingerCredential;
}

/**
 * Create a DNS provider based on configuration.
 *
 * - 'hostinger': HostingerProvider
 * - 'route53': Route53Provider
 * - 'godaddy': GoDaddyProvider
 * - 'manual': Returns null (user handles DNS)
 * - Custom: Use provided DnsProvider implementation
 */
export async function createDnsProvider(
	options: CreateDnsProviderOptions,
): Promise<DnsProvider | null> {
	const { config } = options;

	// Manual mode - no provider needed
	if (config.provider === 'manual') {
		return null;
	}

	// Custom provider implementation
	if (isDnsProvider(config.provider)) {
		return config.provider;
	}

	// Built-in providers
	const provider = config.provider;

	if (provider === 'hostinger') {
		const { HostingerProvider } = await import('@geekmidas/edge/dns/hostinger');
		return new HostingerProvider(async () => {
			const token = options.hostinger?.token ?? (await getHostingerToken());
			if (!token) throw new MissingCredential('hostinger', undefined);
			return { token };
		});
	}

	if (provider === 'route53') {
		const { Route53Provider } = await import('@geekmidas/edge/dns/route53');
		const route53Config = config as Route53DnsConfig;
		return new Route53Provider({
			region: route53Config.region,
			profile: route53Config.profile,
			hostedZoneId: route53Config.hostedZoneId,
		});
	}

	if (provider === 'godaddy') {
		const { GoDaddyProvider } = await import('@geekmidas/edge/dns/godaddy');
		const { credential, env, home, ...rest } = options.godaddy ?? {};
		return new GoDaddyProvider({
			...rest,
			credential: async () => {
				const found =
					credential ??
					(await storedCredentials({
						env: env ?? process.env,
						...(home ? { home } : {}),
					}).get({ kind: 'godaddy' }));
				if (!found) throw new MissingCredential('godaddy', undefined);
				return found;
			},
		});
	}

	if (provider === 'cloudflare') {
		throw new DnsProviderNotImplemented('cloudflare');
	}

	throw new DnsProviderUnknown(config);
}

/** A DNS provider gkm names and does not have yet. */
export class DnsProviderNotImplemented extends Error {
	constructor(readonly provider: string) {
		super(
			`The ${provider} DNS provider is not implemented yet. Use 'route53', ` +
				"'godaddy', 'hostinger' or 'manual' for this domain in dns, or " +
				'pass your own DnsProvider object.',
		);
		this.name = 'DnsProviderNotImplemented';
	}
}

/** A `provider:` that is none of the built-ins, nor a DnsProvider object. */
export class DnsProviderUnknown extends GkmError {
	constructor(readonly config: unknown) {
		super(
			`Unknown DNS provider: ${JSON.stringify(config)}. dns takes ` +
				"'route53', 'godaddy', 'hostinger', 'manual', or an object implementing DnsProvider.",
		);
		this.name = 'DnsProviderUnknown';
	}
}
