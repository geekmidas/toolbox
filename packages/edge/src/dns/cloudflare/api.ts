/**
 * Cloudflare's v4 DNS API, as gkm uses it: the records of one name and type
 * at a time, inside a zone found by its name.
 *
 * - zone: `GET /zones?name={domain}` — the one call that is not a record's
 * - read: `GET /zones/{zone}/dns_records?type={type}&name.exact={fqdn}`
 * - create: `POST /zones/{zone}/dns_records`
 * - update: `PATCH /zones/{zone}/dns_records/{id}`
 * - delete: `DELETE /zones/{zone}/dns_records/{id}`
 *
 * Never the zone itself, its settings or the account. An API token with
 * `Zone:Read` and `DNS:Edit` on the zone is all it needs, sent as
 * `Authorization: Bearer <token>`.
 *
 * Every answer is the v4 envelope — `{ success, errors, result }` — and a
 * failure is read from its `errors`, not from the status alone. A 429 is
 * waited out a few times (its `Retry-After`, else a second) before the run
 * gives up with {@link CloudflareRateLimited}.
 */

import { EdgeError } from '../../errors';

/** A Cloudflare API token, sent as `Authorization: Bearer <token>`. */
export interface CloudflareCredential {
	token: string;
}

export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * Cloudflare's "automatic" TTL — 300 seconds, and the only TTL a proxied
 * record takes.
 */
export const CLOUDFLARE_AUTO_TTL = 1;

/** The record types gkm writes. Never TXT, NS, SOA, SRV or CAA. */
export const CLOUDFLARE_MANAGED_TYPES = ['A', 'AAAA', 'CNAME', 'MX'] as const;

export type CloudflareRecordType = (typeof CLOUDFLARE_MANAGED_TYPES)[number];

/** One record as Cloudflare returns it. */
export interface CloudflareRecord {
	id: string;
	type: string;
	/** The full name: `api.example.com`. */
	name: string;
	content: string;
	ttl: number;
	/** Whether Cloudflare's proxy answers for it — its CDN, the orange cloud. */
	proxied?: boolean;
	/** An MX record's: Cloudflare keeps it apart from `content`. */
	priority?: number;
}

/** What a write sends. */
export interface CloudflareRecordInput {
	type: CloudflareRecordType;
	/** The full name: `api.example.com`. */
	name: string;
	content: string;
	ttl: number;
	proxied?: boolean;
	priority?: number;
}

/** An origin certificate as the Origin CA returns it. */
export interface CloudflareOriginCertificate {
	/** Its serial number. */
	id: string;
	/** PEM. */
	certificate: string;
	hostnames: string[];
	/** `2041-11-22 10:00:00 +0000 UTC` */
	expires_on: string;
}

/** The v4 envelope. */
interface Envelope<T> {
	success: boolean;
	errors?: { code: number; message: string }[];
	result: T;
	result_info?: { page: number; total_pages: number };
}

/** The token is missing, malformed, expired or revoked. */
export class CloudflareCredentialsInvalid extends EdgeError {
	constructor(readonly detail?: string) {
		super(
			`Cloudflare refused the API token${detail ? ` (${detail})` : ''}. ` +
				'Create one at dash.cloudflare.com/profile/api-tokens with Zone:Read ' +
				'and DNS:Edit on the zone, then set CLOUDFLARE_API_TOKEN or run ' +
				'`gkm login --provider cloudflare`.',
		);
		this.name = 'CloudflareCredentialsInvalid';
	}
}

/** The token is good, and may not do this to this zone. */
export class CloudflarePermissionMissing extends EdgeError {
	constructor(
		readonly domain: string,
		readonly detail?: string,
		/** What the token needs for it: `Zone:Read and DNS:Edit`. */
		readonly permission: string = DNS_PERMISSIONS,
	) {
		super(
			`The Cloudflare token was refused on ${domain}` +
				`${detail ? ` (${detail})` : ''}. Give it ${permission} on ` +
				`${domain} (dash.cloudflare.com/profile/api-tokens → the token → Edit).`,
		);
		this.name = 'CloudflarePermissionMissing';
	}
}

/** No zone of that name is in the token's reach. */
export class CloudflareZoneNotFound extends EdgeError {
	constructor(readonly domain: string) {
		super(
			`Cloudflare has no zone ${domain} the token can read. Add ${domain} to ` +
				'the Cloudflare account and point its nameservers at Cloudflare, and ' +
				"make sure the token's zone resources include it.",
		);
		this.name = 'CloudflareZoneNotFound';
	}
}

/** Still rate limited after waiting it out. */
export class CloudflareRateLimited extends EdgeError {
	constructor(readonly attempts: number) {
		super(
			`Cloudflare kept answering 429 Too Many Requests after ${attempts} ` +
				'attempts. Wait a few minutes and deploy again: every record written ' +
				'so far is kept.',
		);
		this.name = 'CloudflareRateLimited';
	}
}

/** Any other answer that is not a success. */
export class CloudflareRequestFailed extends EdgeError {
	constructor(
		readonly method: string,
		readonly path: string,
		readonly status: number,
		/** Cloudflare's `errors`, as it answered them. */
		readonly failures: readonly { code: number; message: string }[],
	) {
		const detail =
			failures.length > 0
				? failures.map((e) => `${e.code}: ${e.message}`).join('; ')
				: `HTTP ${status}`;
		super(`Cloudflare refused ${method} ${path}: ${detail}.`);
		this.name = 'CloudflareRequestFailed';
	}
}

/** A record type gkm does not write. */
export class CloudflareRecordNotAllowed extends EdgeError {
	constructor(
		readonly domain: string,
		readonly type: string,
		/** The record's name, as it was asked for: `api`, `@`. */
		readonly record: string,
	) {
		super(
			`gkm does not manage ${type} records, so it will not touch '${record}' ` +
				`${type} in ${domain}: only ${CLOUDFLARE_MANAGED_TYPES.join(', ')}.`,
		);
		this.name = 'CloudflareRecordNotAllowed';
	}
}

/** What reading and writing a zone's records needs. */
const DNS_PERMISSIONS = 'Zone:Read and DNS:Edit';

/** What an origin certificate needs, beside finding the zone. */
const ORIGIN_CA_PERMISSIONS = 'Zone:Read and SSL and Certificates:Edit';

/** Cloudflare's authentication error codes: a bad or unusable token. */
const AUTH_CODES = new Set([6003, 6111, 9106, 9109, 10000]);

export interface CloudflareApiOptions {
	credential: CloudflareCredential;
	/** The API's base URL, for tests. */
	baseUrl?: string;
	/** How a 429 is waited out, for tests. */
	sleep?: (ms: number) => Promise<void>;
	maxAttempts?: number;
}

export class CloudflareApi {
	private readonly baseUrl: string;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly maxAttempts: number;
	private readonly zones = new Map<string, string>();

	constructor(private readonly options: CloudflareApiOptions) {
		this.baseUrl = (options.baseUrl ?? CLOUDFLARE_API_BASE).replace(/\/$/, '');
		this.sleep =
			options.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.maxAttempts = options.maxAttempts ?? 4;
	}

	private async request<T>(
		domain: string,
		method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
		path: string,
		body?: unknown,
		permission: string = DNS_PERMISSIONS,
	): Promise<Envelope<T>> {
		for (let attempt = 1; ; attempt++) {
			const response = await fetch(`${this.baseUrl}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${this.options.credential.token}`,
					...(body ? { 'Content-Type': 'application/json' } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			});
			if (response.status === 429) {
				if (attempt >= this.maxAttempts) {
					throw new CloudflareRateLimited(attempt);
				}
				const after = Number(response.headers.get('retry-after'));
				await this.sleep(
					Number.isFinite(after) && after > 0 ? after * 1000 : 1000,
				);
				continue;
			}
			let envelope: Envelope<T> | undefined;
			try {
				envelope = (await response.json()) as Envelope<T>;
			} catch {
				envelope = undefined;
			}
			if (response.ok && envelope?.success) return envelope;
			const errors = envelope?.errors ?? [];
			const detail = errors.map((e) => e.message).join('; ') || undefined;
			if (
				response.status === 401 ||
				errors.some((e) => AUTH_CODES.has(e.code))
			) {
				throw new CloudflareCredentialsInvalid(detail);
			}
			if (response.status === 403) {
				throw new CloudflarePermissionMissing(domain, detail, permission);
			}
			throw new CloudflareRequestFailed(method, path, response.status, errors);
		}
	}

	/** The zone's id, found once by its name. */
	async zoneId(domain: string): Promise<string> {
		const key = domain.toLowerCase();
		const known = this.zones.get(key);
		if (known) return known;
		const { result } = await this.request<{ id: string; name: string }[]>(
			key,
			'GET',
			`/zones?name=${encodeURIComponent(key)}`,
		);
		const zone = result.find((z) => z.name.toLowerCase() === key);
		if (!zone) throw new CloudflareZoneNotFound(key);
		this.zones.set(key, zone.id);
		return zone.id;
	}

	/** Every record of exactly this name and type — of the type, without a name. */
	async getRecords(
		domain: string,
		type: CloudflareRecordType,
		fqdn?: string,
	): Promise<CloudflareRecord[]> {
		const zone = await this.zoneId(domain);
		const found: CloudflareRecord[] = [];
		for (let page = 1; ; page++) {
			const query = new URLSearchParams({
				type,
				...(fqdn ? { 'name.exact': fqdn } : {}),
				per_page: '100',
				page: String(page),
			});
			const envelope = await this.request<CloudflareRecord[]>(
				domain,
				'GET',
				`/zones/${zone}/dns_records?${query}`,
			);
			found.push(...envelope.result);
			const info = envelope.result_info;
			if (!info || info.page >= info.total_pages) return found;
		}
	}

	async createRecord(
		domain: string,
		record: CloudflareRecordInput,
	): Promise<CloudflareRecord> {
		const zone = await this.zoneId(domain);
		const { result } = await this.request<CloudflareRecord>(
			domain,
			'POST',
			`/zones/${zone}/dns_records`,
			record,
		);
		return result;
	}

	async updateRecord(
		domain: string,
		id: string,
		record: CloudflareRecordInput,
	): Promise<CloudflareRecord> {
		const zone = await this.zoneId(domain);
		const { result } = await this.request<CloudflareRecord>(
			domain,
			'PATCH',
			`/zones/${zone}/dns_records/${id}`,
			record,
		);
		return result;
	}

	/**
	 * An origin certificate from Cloudflare's Origin CA, for a CSR made where
	 * the key is: trusted by Cloudflare's proxy alone, for `hostnames`, valid
	 * `days` (one of 7, 30, 90, 365, 730, 1095, 5475). The token needs
	 * `Zone → SSL and Certificates → Edit` on the zone.
	 *
	 * @param domain - the zone, for what an error says
	 */
	async createOriginCertificate(
		domain: string,
		request: {
			csr: string;
			hostnames: readonly string[];
			days: number;
			type: 'origin-rsa' | 'origin-ecc';
		},
	): Promise<CloudflareOriginCertificate> {
		const { result } = await this.request<CloudflareOriginCertificate>(
			domain,
			'POST',
			'/certificates',
			{
				csr: request.csr,
				hostnames: [...request.hostnames],
				requested_validity: request.days,
				request_type: request.type,
			},
			ORIGIN_CA_PERMISSIONS,
		);
		return result;
	}

	async deleteRecord(domain: string, id: string): Promise<void> {
		const zone = await this.zoneId(domain);
		await this.request<unknown>(
			domain,
			'DELETE',
			`/zones/${zone}/dns_records/${id}`,
		);
	}
}
