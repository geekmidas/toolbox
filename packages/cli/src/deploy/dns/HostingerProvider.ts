/**
 * Hostinger DNS Provider
 *
 * Implements DnsProvider interface using the Hostinger DNS API.
 */

import { getHostingerToken } from '../../auth/credentials';
import type {
	DeleteDnsRecord,
	DeleteResult,
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

	async deleteRecords(
		domain: string,
		records: DeleteDnsRecord[],
	): Promise<DeleteResult[]> {
		const api = await this.getApi();
		const results: DeleteResult[] = [];

		// Get existing records to check what exists
		const existingRecords = await api.getRecords(domain);

		// Filter to only records that exist
		const recordsToDelete = records.filter((record) =>
			existingRecords.some(
				(r) => r.name === record.name && r.type === record.type,
			),
		);

		// Delete existing records
		if (recordsToDelete.length > 0) {
			try {
				await api.deleteRecords(
					domain,
					recordsToDelete.map((r) => ({
						name: r.name,
						type: r.type as
							| 'A'
							| 'AAAA'
							| 'CNAME'
							| 'MX'
							| 'TXT'
							| 'SRV'
							| 'CAA',
					})),
				);

				for (const record of recordsToDelete) {
					results.push({
						record,
						deleted: true,
						notFound: false,
					});
				}
			} catch (error) {
				// If batch delete fails, report error for all records
				for (const record of recordsToDelete) {
					results.push({
						record,
						deleted: false,
						notFound: false,
						error: String(error),
					});
				}
			}
		}

		// Mark non-existent records as not found
		for (const record of records) {
			const existing = existingRecords.find(
				(r) => r.name === record.name && r.type === record.type,
			);
			if (!existing) {
				results.push({
					record,
					deleted: false,
					notFound: true,
				});
			}
		}

		return results;
	}
}
