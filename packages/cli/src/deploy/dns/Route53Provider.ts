/**
 * Route53 DNS Provider
 *
 * Implements DnsProvider interface using AWS Route53.
 */

import {
	ChangeResourceRecordSetsCommand,
	ListHostedZonesByNameCommand,
	ListResourceRecordSetsCommand,
	Route53Client,
	type RRType,
} from '@aws-sdk/client-route-53';
import { fromIni } from '@aws-sdk/credential-providers';
import type {
	DnsProvider,
	DnsRecord,
	DnsRecordType,
	UpsertDnsRecord,
	UpsertResult,
} from './DnsProvider';

export interface Route53ProviderOptions {
	/** AWS region (optional - uses AWS_REGION env var if not provided) */
	region?: string;
	/** AWS profile name (optional - uses default credential chain if not provided) */
	profile?: string;
	/** Hosted zone ID (optional - auto-detected from domain if not provided) */
	hostedZoneId?: string;
	/** Custom endpoint for testing with localstack */
	endpoint?: string;
}

/**
 * Route53 DNS provider implementation.
 *
 * Uses AWS default credential chain for authentication.
 * Region can be specified or will use AWS_REGION/AWS_DEFAULT_REGION env vars.
 * Profile can be specified to use a named profile from ~/.aws/credentials.
 */
export class Route53Provider implements DnsProvider {
	readonly name = 'route53';
	private client: Route53Client;
	private hostedZoneId?: string;
	private hostedZoneCache: Map<string, string> = new Map();

	constructor(options: Route53ProviderOptions = {}) {
		this.client = new Route53Client({
			...(options.region && { region: options.region }),
			...(options.endpoint && { endpoint: options.endpoint }),
			...(options.profile && { credentials: fromIni({ profile: options.profile }) }),
		});
		this.hostedZoneId = options.hostedZoneId;
	}

	/**
	 * Get the hosted zone ID for a domain.
	 * Uses cache to avoid repeated API calls.
	 */
	private async getHostedZoneId(domain: string): Promise<string> {
		// Use configured zone ID if provided
		if (this.hostedZoneId) {
			return this.hostedZoneId;
		}

		// Check cache
		if (this.hostedZoneCache.has(domain)) {
			return this.hostedZoneCache.get(domain)!;
		}

		// Auto-detect from domain
		const command = new ListHostedZonesByNameCommand({
			DNSName: domain,
			MaxItems: 1,
		});

		const response = await this.client.send(command);
		const zones = response.HostedZones ?? [];

		// Find exact match (domain with trailing dot)
		const normalizedDomain = domain.endsWith('.') ? domain : `${domain}.`;
		const zone = zones.find((z) => z.Name === normalizedDomain);

		if (!zone?.Id) {
			throw new Error(
				`No hosted zone found for domain: ${domain}. Create one in Route53 or provide hostedZoneId in config.`,
			);
		}

		// Zone ID comes as "/hostedzone/Z1234567890" - extract just the ID
		const zoneId = zone.Id.replace('/hostedzone/', '');
		this.hostedZoneCache.set(domain, zoneId);
		return zoneId;
	}

	/**
	 * Convert Route53 record type to our DnsRecordType.
	 * Excludes NS and SOA which are auto-managed by Route53 for the zone.
	 */
	private toRecordType(type: string): DnsRecordType | null {
		// Exclude NS and SOA which are auto-managed zone records
		const managedTypes = ['NS', 'SOA'];
		if (managedTypes.includes(type)) {
			return null;
		}

		const validTypes: DnsRecordType[] = [
			'A',
			'AAAA',
			'CNAME',
			'MX',
			'TXT',
			'SRV',
			'CAA',
		];
		return validTypes.includes(type as DnsRecordType)
			? (type as DnsRecordType)
			: null;
	}

	/**
	 * Extract subdomain from full record name relative to domain.
	 */
	private extractSubdomain(recordName: string, domain: string): string {
		const normalizedDomain = domain.endsWith('.') ? domain : `${domain}.`;
		const normalizedName = recordName.endsWith('.')
			? recordName
			: `${recordName}.`;

		if (normalizedName === normalizedDomain) {
			return '@';
		}

		// Remove the domain suffix
		const subdomain = normalizedName.replace(`.${normalizedDomain}`, '');
		return subdomain.replace(/\.$/, ''); // Remove trailing dot if any
	}

	async getRecords(domain: string): Promise<DnsRecord[]> {
		const zoneId = await this.getHostedZoneId(domain);
		const records: DnsRecord[] = [];

		let nextRecordName: string | undefined;
		let nextRecordType: RRType | undefined;

		// Paginate through all records
		do {
			const command = new ListResourceRecordSetsCommand({
				HostedZoneId: zoneId,
				StartRecordName: nextRecordName,
				StartRecordType: nextRecordType,
				MaxItems: 100,
			});

			const response = await this.client.send(command);

			for (const recordSet of response.ResourceRecordSets ?? []) {
				const type = this.toRecordType(recordSet.Type ?? '');
				if (!type || !recordSet.Name) continue;

				const values = (recordSet.ResourceRecords ?? [])
					.map((r) => r.Value)
					.filter((v): v is string => !!v);

				records.push({
					name: this.extractSubdomain(recordSet.Name, domain),
					type,
					ttl: recordSet.TTL ?? 300,
					values,
				});
			}

			if (response.IsTruncated) {
				nextRecordName = response.NextRecordName;
				nextRecordType = response.NextRecordType;
			} else {
				nextRecordName = undefined;
			}
		} while (nextRecordName);

		return records;
	}

	async upsertRecords(
		domain: string,
		records: UpsertDnsRecord[],
	): Promise<UpsertResult[]> {
		const zoneId = await this.getHostedZoneId(domain);
		const results: UpsertResult[] = [];

		// Get existing records to determine if creating or updating
		const existingRecords = await this.getRecords(domain);

		// Process records in batches (Route53 allows max 1000 changes per request)
		const batchSize = 100;
		for (let i = 0; i < records.length; i += batchSize) {
			const batch = records.slice(i, i + batchSize);
			const changes = [];

			for (const record of batch) {
				const existing = existingRecords.find(
					(r) => r.name === record.name && r.type === record.type,
				);

				const existingValue = existing?.values?.[0];

				if (existing && existingValue === record.value) {
					// Record exists with same value - unchanged
					results.push({
						record,
						created: false,
						unchanged: true,
					});
					continue;
				}

				// Build full record name
				const recordName =
					record.name === '@' ? domain : `${record.name}.${domain}`;

				changes.push({
					Action: 'UPSERT' as const,
					ResourceRecordSet: {
						Name: recordName,
						Type: record.type,
						TTL: record.ttl,
						ResourceRecords: [{ Value: record.value }],
					},
				});

				results.push({
					record,
					created: !existing,
					unchanged: false,
				});
			}

			// Execute batch if there are changes
			if (changes.length > 0) {
				const command = new ChangeResourceRecordSetsCommand({
					HostedZoneId: zoneId,
					ChangeBatch: {
						Comment: 'Upsert by gkm deploy',
						Changes: changes,
					},
				});

				await this.client.send(command);
			}
		}

		return results;
	}
}
