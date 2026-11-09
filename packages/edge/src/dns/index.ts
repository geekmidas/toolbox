/**
 * DNS Provider Interface
 *
 * Abstracts DNS operations for different providers.
 * Built-in providers: HostingerProvider, Route53Provider, GoDaddyProvider
 * Users can also supply custom implementations.
 *
 * Every value is the record's zone-file form, read and written alike: an MX
 * record's is `<priority> <host>` (see {@link mxValue}).
 */

import { EdgeError } from '../errors';

// =============================================================================
// DNS Record Types (derived from Zod schemas)
// =============================================================================

/** DNS record types supported across providers. */
export type DnsRecordType =
	| 'A'
	| 'AAAA'
	| 'CNAME'
	| 'MX'
	| 'TXT'
	| 'NS'
	| 'SRV'
	| 'CAA';

/** A DNS record as returned by the provider. */
export interface DnsRecord {
	/** Subdomain name (e.g., 'api' for api.example.com, '@' for root) */
	name: string;
	type: DnsRecordType;
	/** TTL in seconds */
	ttl: number;
	/**
	 * Record values, as a zone file writes them: an MX record's is
	 * `<priority> <host>` (`10 inbound-smtp.eu-west-1.amazonaws.com`).
	 */
	values: string[];
}

/** A DNS record to create or update. */
export interface UpsertDnsRecord {
	/** Subdomain name (e.g., 'api' for api.example.com, '@' for root) */
	name: string;
	type: DnsRecordType;
	/** TTL in seconds */
	ttl: number;
	/**
	 * Record value (IP address, hostname, etc.), as a zone file writes it: an
	 * MX record's is `<priority> <host>` — see `mxValue`.
	 */
	value: string;
}

/** Result of an upsert operation. */
export interface UpsertResult {
	/** The record that was upserted */
	record: UpsertDnsRecord;
	/** Whether the record was created (true) or updated (false) */
	created: boolean;
	/** Whether the record already existed with the same value */
	unchanged: boolean;
}

// =============================================================================
// MX values
// =============================================================================

/**
 * An MX record's value as every provider here reads and writes it — the zone
 * file's `<priority> <host>`, which is what Route53 and Hostinger take as is.
 * A provider whose API keeps the priority apart (GoDaddy) splits it with
 * {@link parseMxValue}.
 */
export function mxValue(priority: number, host: string): string {
	return `${priority} ${host.trim().replace(/\.$/, '')}`;
}

/** An MX value that is not `<priority> <host>`. */
export class MxValueInvalid extends EdgeError {
	constructor(readonly value: string) {
		super(
			`'${value}' is not an MX record's value: it is written ` +
				"'<priority> <host>', like '10 inbound-smtp.eu-west-1.amazonaws.com'. " +
				'Build it with mxValue(priority, host).',
		);
		this.name = 'MxValueInvalid';
	}
}

/**
 * The priority and host of an MX value.
 *
 * @throws {MxValueInvalid} for a value that is not `<priority> <host>`
 */
export function parseMxValue(value: string): {
	priority: number;
	host: string;
} {
	const match = value.trim().match(/^(\d{1,5})\s+(\S+)$/);
	const priority = match ? Number(match[1]) : Number.NaN;
	if (!match || priority > 65535) throw new MxValueInvalid(value);
	return { priority, host: match[2]!.replace(/\.$/, '') };
}

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

/**
 * The provider's credentials can write records and not read them — a key
 * scoped to updates only. What reads them falls back to writing every record,
 * which is idempotent, without a diff.
 */
export class DnsRecordsUnreadable extends EdgeError {
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
