/**
 * Hostinger DNS Provider
 *
 * Implements DnsProvider interface using the Hostinger DNS API.
 */

import { getHostingerToken } from '../../auth/credentials';
import type {
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
	UpsertResult,
} from './DnsProvider';
import { HostingerApi } from './hostinger-api';

/**
 * Hostinger DNS provider implementation.
 */
export class HostingerProvider implements DnsProvider {
	readonly name = 'hostinger';
	private api: HostingerApi | null = null;

	/**
	 * Get or create the Hostinger API client.
	 */
	private async getApi(): Promise<HostingerApi> {
		if (this.api) {
			return this.api;
		}

		const token = await getHostingerToken();
		if (!token) {
			throw new Error(
				'Hostinger API token not configured. Run `gkm login --service=hostinger` or get your token from https://hpanel.hostinger.com/profile/api',
			);
		}

		this.api = new HostingerApi(token);
		return this.api;
	}

	async getRecords(domain: string): Promise<DnsRecord[]> {
		const api = await this.getApi();
		const records = await api.getRecords(domain);

		return records.map((r) => ({
			name: r.name,
			type: r.type,
			ttl: r.ttl,
			values: r.records.map((rec) => rec.content),
		}));
	}

	async upsertRecords(
		domain: string,
		records: UpsertDnsRecord[],
	): Promise<UpsertResult[]> {
		const api = await this.getApi();
		const results: UpsertResult[] = [];

		// Get existing records to check what already exists
		const existingRecords = await api.getRecords(domain);

		for (const record of records) {
			const existing = existingRecords.find(
				(r) => r.name === record.name && r.type === record.type,
			);

			const existingValue = existing?.records?.[0]?.content;

			if (existing && existingValue === record.value) {
				// Record exists with same value - unchanged
				results.push({
					record,
					created: false,
					unchanged: true,
				});
				continue;
			}

			// Create or update the record
			await api.upsertRecords(domain, [
				{
					name: record.name,
					type: record.type,
					ttl: record.ttl,
					records: [{ content: record.value }],
				},
			]);

			results.push({
				record,
				created: !existing,
				unchanged: false,
			});
		}

		return results;
	}
}
