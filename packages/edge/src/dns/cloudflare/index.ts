/**
 * Cloudflare DNS Provider
 *
 * Implements DnsProvider against Cloudflare's v4 API, one name and type at a
 * time: it reads and writes only the A, AAAA, CNAME and MX records of the
 * names it is handed, inside the zone found by the domain's name, and never
 * the zone's settings or the account. An API token with `Zone:Read` and
 * `DNS:Edit` on the zone is all it needs.
 *
 * Cloudflare is also a CDN: a record it proxies (`proxied: true`, the orange
 * cloud) is answered by Cloudflare's edge, which forwards to the record's
 * value. A write that says `proxied` sets it; one that does not leaves an
 * existing record's as it was and creates a new one unproxied — so a
 * certificate's validation CNAME, which Cloudflare must not answer, is
 * never proxied by accident. A proxied record's TTL is always Cloudflare's
 * automatic one.
 *
 * Cloudflare can hold several records of one name and type; an upsert leaves
 * exactly one, with its value. An MX value is `<priority> <host>` on the
 * DnsProvider side, as everywhere in gkm; Cloudflare keeps the priority
 * apart, so it is split on a write and joined on a read.
 *
 * Credentials: `CLOUDFLARE_API_TOKEN`, else what `gkm login --provider
 * cloudflare` stored. Never logged.
 */

import {
	type DeleteDnsRecord,
	type DeleteResult,
	type DnsProvider,
	type DnsRecord,
	mxValue,
	parseMxValue,
	type UpsertDnsRecord,
	type UpsertResult,
} from '../index';
import {
	CLOUDFLARE_AUTO_TTL,
	CLOUDFLARE_MANAGED_TYPES,
	CloudflareApi,
	type CloudflareApiOptions,
	type CloudflareCredential,
	type CloudflareRecord,
	type CloudflareRecordInput,
	CloudflareRecordNotAllowed,
	type CloudflareRecordType,
} from './api';

/** Cloudflare refuses a TTL under this, but for its automatic one. */
const CLOUDFLARE_MIN_TTL = 60;

export interface CloudflareProviderOptions {
	/**
	 * Where the token comes from, asked the first time the API is called. It
	 * throws when there is none: what to do about a missing token is the
	 * caller's to say.
	 */
	credential: () => Promise<CloudflareCredential>;
	/** The API's base URL, for tests. */
	baseUrl?: string;
	/** How a 429 is waited out, for tests. */
	sleep?: CloudflareApiOptions['sleep'];
	maxAttempts?: number;
}

/** A value compared the way DNS does: case-insensitive, no trailing dot. */
function normalize(value: string): string {
	return value.trim().replace(/\.$/, '').replace(/\s+/g, ' ').toLowerCase();
}

/** `api` under `example.com` → `api.example.com`; `@` → `example.com`. */
export function fullName(name: string, domain: string): string {
	const zone = domain.toLowerCase().replace(/\.$/, '');
	const label = name.trim().toLowerCase().replace(/\.$/, '');
	if (label === '@' || label === '' || label === zone) return zone;
	return label.endsWith(`.${zone}`) ? label : `${label}.${zone}`;
}

/** A Cloudflare record's value in gkm's form: an MX's is `<priority> <host>`. */
function valueOf(record: CloudflareRecord): string {
	return record.type === 'MX'
		? mxValue(record.priority ?? 0, record.content)
		: record.content;
}

function managed(type: string): type is CloudflareRecordType {
	return (CLOUDFLARE_MANAGED_TYPES as readonly string[]).includes(type);
}

/** Only an address or an alias can be proxied. */
function proxiable(type: string): boolean {
	return type === 'A' || type === 'AAAA' || type === 'CNAME';
}

export class CloudflareProvider implements DnsProvider {
	readonly name = 'cloudflare';
	private api: CloudflareApi | null = null;

	constructor(private readonly options: CloudflareProviderOptions) {}

	private async getApi(): Promise<CloudflareApi> {
		if (this.api) return this.api;
		const credential = await this.options.credential();
		this.api = new CloudflareApi({
			credential,
			...(this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {}),
			...(this.options.sleep ? { sleep: this.options.sleep } : {}),
			...(this.options.maxAttempts
				? { maxAttempts: this.options.maxAttempts }
				: {}),
		});
		return this.api;
	}

	private assertManaged(domain: string, type: string, name: string): void {
		if (!managed(type))
			throw new CloudflareRecordNotAllowed(domain, type, name);
	}

	/**
	 * The managed records of the whole zone: A, AAAA, CNAME and MX. Prefer
	 * {@link readRecords}, which asks for exactly the names it needs.
	 */
	async getRecords(domain: string): Promise<DnsRecord[]> {
		const api = await this.getApi();
		const zone = domain.toLowerCase();
		const out: DnsRecord[] = [];
		for (const type of CLOUDFLARE_MANAGED_TYPES) {
			const records = await api.getRecords(zone, type);
			out.push(...group(zone, type, records));
		}
		return out;
	}

	/** The records of exactly these names and types, one request each. */
	async readRecords(
		domain: string,
		wanted: readonly DeleteDnsRecord[],
	): Promise<DnsRecord[]> {
		for (const { name, type } of wanted) this.assertManaged(domain, type, name);
		const api = await this.getApi();
		const found: DnsRecord[] = [];
		for (const { name, type } of wanted) {
			const records = await api.getRecords(
				domain,
				type as CloudflareRecordType,
				fullName(name, domain),
			);
			found.push(...group(domain, type as CloudflareRecordType, records, name));
		}
		return found;
	}

	/**
	 * Each name and type set to exactly its one value: read it, and write it
	 * only when its value or its proxy differ. The first record of the name
	 * is updated in place and any other of that type deleted, so the set
	 * ends up with one.
	 */
	async upsertRecords(
		domain: string,
		records: UpsertDnsRecord[],
	): Promise<UpsertResult[]> {
		// Every record is checked before any is written, so a refused one
		// leaves the zone as it was.
		for (const record of records) {
			this.assertManaged(domain, record.type, record.name);
		}
		const api = await this.getApi();

		const results: UpsertResult[] = [];
		for (const record of records) {
			const type = record.type as CloudflareRecordType;
			const name = fullName(record.name, domain);
			const existing = await api.getRecords(domain, type, name);
			const [first, ...rest] = existing;
			const proxied = proxiable(type)
				? (record.proxied ?? first?.proxied ?? false)
				: undefined;

			if (
				first &&
				rest.length === 0 &&
				normalize(valueOf(first)) === normalize(record.value) &&
				(proxied === undefined || (first.proxied ?? false) === proxied)
			) {
				results.push({ record, created: false, unchanged: true });
				continue;
			}

			const input = recordInput(type, name, record, proxied);
			if (first) await api.updateRecord(domain, first.id, input);
			else await api.createRecord(domain, input);
			for (const extra of rest) await api.deleteRecord(domain, extra.id);
			results.push({ record, created: !first, unchanged: false });
		}
		return results;
	}

	async deleteRecords(
		domain: string,
		records: DeleteDnsRecord[],
	): Promise<DeleteResult[]> {
		for (const record of records) {
			this.assertManaged(domain, record.type, record.name);
		}
		const api = await this.getApi();
		const results: DeleteResult[] = [];
		for (const record of records) {
			const existing = await api.getRecords(
				domain,
				record.type as CloudflareRecordType,
				fullName(record.name, domain),
			);
			if (existing.length === 0) {
				results.push({ record, deleted: false, notFound: true });
				continue;
			}
			for (const found of existing) await api.deleteRecord(domain, found.id);
			results.push({ record, deleted: true, notFound: false });
		}
		return results;
	}
}

/** What a write sends for one record. */
function recordInput(
	type: CloudflareRecordType,
	name: string,
	record: UpsertDnsRecord,
	proxied: boolean | undefined,
): CloudflareRecordInput {
	const ttl = proxied
		? CLOUDFLARE_AUTO_TTL
		: Math.max(record.ttl, CLOUDFLARE_MIN_TTL);
	if (type === 'MX') {
		const { priority, host } = parseMxValue(record.value);
		return { type, name, content: host, priority, ttl };
	}
	return {
		type,
		name,
		content: record.value.trim().replace(/\.$/, ''),
		ttl,
		...(proxied !== undefined ? { proxied } : {}),
	};
}

/**
 * Cloudflare's records as DnsRecords: one per name, its values together,
 * named relative to the domain (`@` for the apex) — or as `asked`, when the
 * caller named it.
 */
function group(
	domain: string,
	type: CloudflareRecordType,
	records: readonly CloudflareRecord[],
	asked?: string,
): DnsRecord[] {
	const zone = domain.toLowerCase();
	const byName = new Map<string, CloudflareRecord[]>();
	for (const record of records) {
		const fqdn = record.name.toLowerCase();
		byName.set(fqdn, [...(byName.get(fqdn) ?? []), record]);
	}
	return [...byName.entries()].map(([fqdn, set]) => ({
		name:
			asked ??
			(fqdn === zone ? '@' : fqdn.slice(0, fqdn.length - zone.length - 1)),
		type,
		ttl: set[0]!.ttl === CLOUDFLARE_AUTO_TTL ? 300 : set[0]!.ttl,
		values: set.map(valueOf),
		...(proxiable(type) ? { proxied: set[0]!.proxied ?? false } : {}),
	}));
}

export {
	CLOUDFLARE_API_BASE,
	CLOUDFLARE_AUTO_TTL,
	CLOUDFLARE_MANAGED_TYPES,
	CloudflareApi,
	type CloudflareApiOptions,
	type CloudflareCredential,
	CloudflareCredentialsInvalid,
	type CloudflareOriginCertificate,
	CloudflarePermissionMissing,
	CloudflareRateLimited,
	type CloudflareRecord,
	type CloudflareRecordInput,
	CloudflareRecordNotAllowed,
	type CloudflareRecordType,
	CloudflareRequestFailed,
	CloudflareZoneNotFound,
} from './api';
