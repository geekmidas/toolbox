/**
 * DNS Provider Interface
 *
 * Abstracts DNS operations for different providers.
 * Built-in providers: HostingerProvider, Route53Provider
 * Users can also supply custom implementations.
 */

import type { z } from 'zod/v4';
import type {
	CloudflareDnsConfigSchema,
	CustomDnsConfigSchema,
	DnsConfigSchema,
	DnsRecordSchema,
	DnsRecordTypeSchema,
	HostingerDnsConfigSchema,
	ManualDnsConfigSchema,
	Route53DnsConfigSchema,
	UpsertDnsRecordSchema,
	UpsertResultSchema,
} from '../../workspace/schema';

// =============================================================================
// DNS Record Types (derived from Zod schemas)
// =============================================================================

/**
 * DNS record types supported across providers.
 */
export type DnsRecordType = z.infer<typeof DnsRecordTypeSchema>;

/**
 * A DNS record as returned by the provider.
 */
export type DnsRecord = z.infer<typeof DnsRecordSchema>;

/**
 * A DNS record to create or update.
 */
export type UpsertDnsRecord = z.infer<typeof UpsertDnsRecordSchema>;

/**
 * Result of an upsert operation.
 */
export type UpsertResult = z.infer<typeof UpsertResultSchema>;

// =============================================================================
// DNS Provider Interface
// =============================================================================

/**
 * Interface for DNS providers.
 *
 * Implementations must handle:
 * - Getting all records for a domain
 * - Creating or updating records for a domain
 */
export interface DnsProvider {
	/** Provider name for logging */
	readonly name: string;

	/**
	 * Get all DNS records for a domain.
	 *
	 * @param domain - Root domain (e.g., 'example.com')
	 * @returns Array of DNS records
	 */
	getRecords(domain: string): Promise<DnsRecord[]>;

	/**
	 * Create or update DNS records.
	 *
	 * @param domain - Root domain (e.g., 'example.com')
	 * @param records - Records to create or update
	 * @returns Results of the upsert operations
	 */
	upsertRecords(
		domain: string,
		records: UpsertDnsRecord[],
	): Promise<UpsertResult[]>;
}

// =============================================================================
// DNS Config Types (derived from Zod schemas)
// =============================================================================

export type HostingerDnsConfig = z.infer<typeof HostingerDnsConfigSchema>;
export type Route53DnsConfig = z.infer<typeof Route53DnsConfigSchema>;
export type CloudflareDnsConfig = z.infer<typeof CloudflareDnsConfigSchema>;
export type ManualDnsConfig = z.infer<typeof ManualDnsConfigSchema>;
export type CustomDnsConfig = z.infer<typeof CustomDnsConfigSchema>;
export type DnsConfig = z.infer<typeof DnsConfigSchema>;

// =============================================================================
// DNS Provider Factory
// =============================================================================

/**
 * Check if value is a DnsProvider implementation.
 */
export function isDnsProvider(value: unknown): value is DnsProvider {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as DnsProvider).name === 'string' &&
		typeof (value as DnsProvider).getRecords === 'function' &&
		typeof (value as DnsProvider).upsertRecords === 'function'
	);
}

export interface CreateDnsProviderOptions {
	/** DNS config from workspace */
	config: DnsConfig;
}

/**
 * Create a DNS provider based on configuration.
 *
 * - 'hostinger': HostingerProvider
 * - 'route53': Route53Provider
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
		const { HostingerProvider } = await import('./HostingerProvider');
		return new HostingerProvider();
	}

	if (provider === 'route53') {
		const { Route53Provider } = await import('./Route53Provider');
		const route53Config = config as Route53DnsConfig;
		return new Route53Provider({
			region: route53Config.region,
			hostedZoneId: route53Config.hostedZoneId,
		});
	}

	if (provider === 'cloudflare') {
		throw new Error('Cloudflare DNS provider not yet implemented');
	}

	throw new Error(`Unknown DNS provider: ${JSON.stringify(config)}`);
}
