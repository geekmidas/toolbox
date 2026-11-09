/**
 * Hostinger DNS Provider
 *
 * Implements DnsProvider interface using the Hostinger DNS API. A record's
 * `content` is its zone-file value — an MX record's is `<priority> <host>`,
 * Hostinger having no field of its own for the priority — so values pass
 * through as they are. Each write replaces its one name and type
 * (`overwrite: true`): without it Hostinger appends, and a record with
 * another value would end up holding both.
 */

import type {
	DeleteDnsRecord,
	DeleteResult,
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
	UpsertResult,
} from '../index';
import { HostingerApi } from './api';

/** A Hostinger API token, from hpanel.hostinger.com/profile/api. */
export interface HostingerCredential {
	token: string;
}

/** A value compared the way DNS does: case, a trailing dot and spacing aside. */
function normalize(value: string): string {
	return value.trim().replace(/\.$/, '').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Hostinger DNS provider implementation.
 */
export class HostingerProvider implements DnsProvider {
	readonly name = 'hostinger';
	private api: HostingerApi | null = null;

	/**
	 * `credential`: where the token comes from, asked the first time the API
	 * is called. It throws when there is none: what to do about a missing
	 * token is the caller's to say.
	 */
	constructor(
		private readonly credential: () => Promise<HostingerCredential>,
	) {}

	/**
	 * Get or create the Hostinger API client.
	 */
	private async getApi(): Promise<HostingerApi> {
		if (this.api) {
			return this.api;
		}

		const { token } = await this.credential();

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

			if (
				existing &&
				existingValue !== undefined &&
				normalize(existingValue) === normalize(record.value)
			) {
				// Record exists with same value - unchanged
				results.push({
					record,
					created: false,
					unchanged: true,
				});
				continue;
			}

			// Create the record, or replace this name's records of this type.
			await api.upsertRecords(
				domain,
				[
					{
						name: record.name,
						type: record.type,
						ttl: record.ttl,
						records: [{ content: record.value }],
					},
				],
				true,
			);

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

export { HostingerApi, HostingerApiError } from './api';
