/**
 * DNS Provider Interface
 *
 * Abstracts DNS operations for different providers.
 * Built-in providers: HostingerProvider, Route53Provider, GoDaddyProvider
 * Users can also supply custom implementations.
 */

import type { z } from 'zod/v4';
import type {
	CloudflareDnsProviderSchema,
	CustomDnsProviderSchema,
	DnsProviderSchema,
	DnsRecordSchema,
	DnsRecordTypeSchema,
	GoDaddyDnsProviderSchema,
	HostingerDnsProviderSchema,
	ManualDnsProviderSchema,
	Route53DnsProviderSchema,
	UpsertDnsRecordSchema,
	UpsertResultSchema,
} from '../../../workspace/schema';

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
 * A record to delete from DNS.
 */
export interface DeleteDnsRecord {
	/** Record name/subdomain (e.g., 'api' or '@' for root) */
	name: string;
	/** Record type (A, CNAME, etc.) */
	type: DnsRecordType;
}

/**
 * Result of a delete operation.
 */
export interface DeleteResult {
	/** The record that was requested for deletion */
	record: DeleteDnsRecord;
	/** Whether the record was deleted */
	deleted: boolean;
	/** Whether the record was not found (already deleted) */
	notFound: boolean;
	/** Error message if deletion failed */
	error?: string;
}

/**
 * Interface for DNS providers.
 *
 * Implementations must handle:
 * - Getting all records for a domain
 * - Creating or updating records for a domain
 * - Deleting records from a domain
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
	 * The records of exactly these names and types, where the provider can
	 * read them one at a time — cheaper than the whole zone on an API that
	 * counts requests. Optional: without it, `getRecords` is filtered.
	 * Throws {@link DnsRecordsUnreadable} when the credentials can only write.
	 *
	 * @param domain - Root domain (e.g., 'example.com')
	 * @param wanted - The names ('@' for the root) and types to read
	 */
	readRecords?(
		domain: string,
		wanted: readonly DeleteDnsRecord[],
	): Promise<DnsRecord[]>;

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

	/**
	 * Delete DNS records.
	 *
	 * @param domain - Root domain (e.g., 'example.com')
	 * @param records - Records to delete
	 * @returns Results of the delete operations
	 */
	deleteRecords(
		domain: string,
		records: DeleteDnsRecord[],
	): Promise<DeleteResult[]>;
}

// =============================================================================
// DNS Provider Config Types (derived from Zod schemas)
// =============================================================================

export type HostingerDnsConfig = z.infer<typeof HostingerDnsProviderSchema>;
export type Route53DnsConfig = z.infer<typeof Route53DnsProviderSchema>;
export type GoDaddyDnsConfig = z.infer<typeof GoDaddyDnsProviderSchema>;
export type CloudflareDnsConfig = z.infer<typeof CloudflareDnsProviderSchema>;
export type ManualDnsConfig = z.infer<typeof ManualDnsProviderSchema>;
export type CustomDnsConfig = z.infer<typeof CustomDnsProviderSchema>;
/** Single DNS provider config (for one domain) */
export type DnsConfig = z.infer<typeof DnsProviderSchema>;

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
		typeof (value as DnsProvider).upsertRecords === 'function' &&
		typeof (value as DnsProvider).deleteRecords === 'function'
	);
}

export interface CreateDnsProviderOptions {
	/** DNS config from workspace */
	config: DnsConfig;
	/** Where the GoDaddy provider reads its key — the environment and the CLI's home. */
	godaddy?: import('./GoDaddyProvider').GoDaddyProviderOptions;
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
		const { HostingerProvider } = await import('./HostingerProvider');
		return new HostingerProvider();
	}

	if (provider === 'route53') {
		const { Route53Provider } = await import('./Route53Provider');
		const route53Config = config as Route53DnsConfig;
		return new Route53Provider({
			region: route53Config.region,
			profile: route53Config.profile,
			hostedZoneId: route53Config.hostedZoneId,
		});
	}

	if (provider === 'godaddy') {
		const { GoDaddyProvider } = await import('./GoDaddyProvider');
		return new GoDaddyProvider(options.godaddy ?? {});
	}

	if (provider === 'cloudflare') {
		throw new DnsProviderNotImplemented('cloudflare');
	}

	throw new DnsProviderUnknown(config);
}

/**
 * The provider's credentials can write records and not read them — a key
 * scoped to updates only. What reads them falls back to writing every record,
 * which is idempotent, without a diff.
 */
export class DnsRecordsUnreadable extends Error {
	constructor(
		readonly provider: string,
		readonly domain: string,
		readonly reason: string,
	) {
		super(
			`The ${provider} key cannot read ${domain}'s DNS records (${reason}), so ` +
				'changes cannot be compared with what is there: every record is ' +
				'written, which leaves one that already has its value as it was.',
		);
		this.name = 'DnsRecordsUnreadable';
	}
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
export class DnsProviderUnknown extends Error {
	constructor(readonly config: unknown) {
		super(
			`Unknown DNS provider: ${JSON.stringify(config)}. dns takes ` +
				"'route53', 'godaddy', 'hostinger', 'manual', or an object implementing DnsProvider.",
		);
		this.name = 'DnsProviderUnknown';
	}
}
