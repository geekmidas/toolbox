/**
 * Hostinger DNS API client
 *
 * API Documentation: https://developers.hostinger.com/
 * Authentication: Bearer token from hpanel.hostinger.com/profile/api
 */

const HOSTINGER_API_BASE = 'https://developers.hostinger.com';

/**
 * DNS record types supported by Hostinger
 */
export type DnsRecordType =
	| 'A'
	| 'AAAA'
	| 'CNAME'
	| 'MX'
	| 'TXT'
	| 'NS'
	| 'SRV'
	| 'CAA';

/**
 * A single DNS record
 */
export interface DnsRecord {
	/** Subdomain name (e.g., 'api.joemoer' for api.joemoer.traflabs.io) */
	name: string;
	/** Record type */
	type: DnsRecordType;
	/** TTL in seconds */
	ttl: number;
	/** Record values */
	records: Array<{ content: string }>;
}

/**
 * Filter for deleting specific records
 */
export interface DnsRecordFilter {
	name: string;
	type: DnsRecordType;
}

/**
 * API error response
 */
export interface HostingerErrorResponse {
	message?: string;
	errors?: Record<string, string[]>;
}

/**
 * Hostinger API error
 */
export class HostingerApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public statusText: string,
		public errors?: Record<string, string[]>,
	) {
		super(message);
		this.name = 'HostingerApiError';
	}
}

/**
 * Hostinger DNS API client
 *
 * @example
 * ```ts
 * const api = new HostingerApi(token);
 *
 * // Get all records for a domain
 * const records = await api.getRecords('traflabs.io');
 *
 * // Create/update records
 * await api.upsertRecords('traflabs.io', [
 *   { name: 'api.joemoer', type: 'A', ttl: 300, records: ['1.2.3.4'] }
 * ]);
 * ```
 */
export class HostingerApi {
	private token: string;

	constructor(token: string) {
		this.token = token;
	}

	/**
	 * Make a request to the Hostinger API
	 */
	private async request<T>(
		method: 'GET' | 'POST' | 'PUT' | 'DELETE',
		endpoint: string,
		body?: unknown,
	): Promise<T> {
		const url = `${HOSTINGER_API_BASE}${endpoint}`;

		const response = await fetch(url, {
			method,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.token}`,
			},
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			let errorMessage = `Hostinger API error: ${response.status} ${response.statusText}`;
			let errors: Record<string, string[]> | undefined;

			try {
				const errorBody = (await response.json()) as HostingerErrorResponse;
				if (errorBody.message) {
					errorMessage = `Hostinger API error: ${errorBody.message}`;
				}
				errors = errorBody.errors;
			} catch {
				// Ignore JSON parse errors
			}

			throw new HostingerApiError(
				errorMessage,
				response.status,
				response.statusText,
				errors,
			);
		}

		// Handle empty responses
		const text = await response.text();
		if (!text || text.trim() === '') {
			return undefined as T;
		}
		return JSON.parse(text) as T;
	}

	/**
	 * Get all DNS records for a domain
	 *
	 * @param domain - Root domain (e.g., 'traflabs.io')
	 */
	async getRecords(domain: string): Promise<DnsRecord[]> {
		interface RecordResponse {
			data: Array<{
				name: string;
				type: DnsRecordType;
				ttl: number;
				records: Array<{ content: string }>;
			}>;
		}

		const response = await this.request<RecordResponse>(
			'GET',
			`/api/dns/v1/zones/${domain}`,
		);

		return response.data || [];
	}

	/**
	 * Create or update DNS records
	 *
	 * @param domain - Root domain (e.g., 'traflabs.io')
	 * @param records - Records to create/update
	 * @param overwrite - If true, replaces all existing records. If false, merges with existing.
	 */
	async upsertRecords(
		domain: string,
		records: DnsRecord[],
		overwrite = false,
	): Promise<void> {
		await this.request('PUT', `/api/dns/v1/zones/${domain}`, {
			overwrite,
			zone: records,
		});
	}

	/**
	 * Validate DNS records before applying
	 *
	 * @param domain - Root domain (e.g., 'traflabs.io')
	 * @param records - Records to validate
	 * @returns true if valid, throws if invalid
	 */
	async validateRecords(
		domain: string,
		records: DnsRecord[],
	): Promise<boolean> {
		await this.request('POST', `/api/dns/v1/zones/${domain}/validate`, {
			overwrite: false,
			zone: records,
		});
		return true;
	}

	/**
	 * Delete specific DNS records
	 *
	 * @param domain - Root domain (e.g., 'traflabs.io')
	 * @param filters - Filters to match records for deletion
	 */
	async deleteRecords(
		domain: string,
		filters: DnsRecordFilter[],
	): Promise<void> {
		await this.request('DELETE', `/api/dns/v1/zones/${domain}`, {
			filters,
		});
	}

	/**
	 * Check if a specific record exists
	 *
	 * @param domain - Root domain (e.g., 'traflabs.io')
	 * @param name - Subdomain name (e.g., 'api.joemoer')
	 * @param type - Record type (e.g., 'A')
	 */
	async recordExists(
		domain: string,
		name: string,
		type: DnsRecordType = 'A',
	): Promise<boolean> {
		const records = await this.getRecords(domain);
		return records.some((r) => r.name === name && r.type === type);
	}

	/**
	 * Create a single A record if it doesn't exist
	 *
	 * @param domain - Root domain (e.g., 'traflabs.io')
	 * @param subdomain - Subdomain name (e.g., 'api.joemoer')
	 * @param ip - IP address to point to
	 * @param ttl - TTL in seconds (default: 300)
	 * @returns true if created, false if already exists
	 */
	async createARecordIfNotExists(
		domain: string,
		subdomain: string,
		ip: string,
		ttl = 300,
	): Promise<boolean> {
		const exists = await this.recordExists(domain, subdomain, 'A');
		if (exists) {
			return false;
		}

		await this.upsertRecords(domain, [
			{
				name: subdomain,
				type: 'A',
				ttl,
				records: [{ content: ip }],
			},
		]);

		return true;
	}
}
