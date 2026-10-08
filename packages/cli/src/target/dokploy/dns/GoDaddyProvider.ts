/**
 * GoDaddy DNS Provider
 *
 * Implements DnsProvider against GoDaddy's v1 API, one record set — a name
 * and a type — at a time: it reads and writes only the A, AAAA and CNAME
 * records of the names it is handed, and never the zone as a whole, a domain
 * or the account. A Personal Access Token scoped to `domains.dns:update` is all it needs.
 *
 * A token that may write records and not read them puts the provider in
 * write-only mode: every record is PUT — idempotent, so one that already has
 * its value is left as it was — and nothing is compared or deleted.
 *
 * Credentials: `GODADDY_API_TOKEN`, else what `gkm login --provider godaddy`
 * stored. Never logged.
 */

import {
	type GoDaddyCredential,
	MissingCredential,
	storedCredentials,
} from '../../../deploy/credentials';
import {
	type DeleteDnsRecord,
	type DeleteResult,
	type DnsProvider,
	type DnsRecord,
	DnsRecordsUnreadable,
	type UpsertDnsRecord,
	type UpsertResult,
} from './DnsProvider';
import {
	GODADDY_MANAGED_TYPES,
	GODADDY_MIN_TTL,
	GoDaddyApi,
	GoDaddyApiAccessDenied,
	type GoDaddyApiOptions,
	GoDaddyDomainNotFound,
	type GoDaddyRecord,
	GoDaddyRecordNotAllowed,
	type GoDaddyRecordType,
	GoDaddyScopeMissing,
} from './godaddy-api';

export interface GoDaddyProviderOptions {
	/** The token, when the caller already has it. */
	credential?: GoDaddyCredential;
	/** Where the variables are read — `process.env` by default. */
	env?: NodeJS.ProcessEnv;
	/** The CLI's home, whose `credentials.json` holds a stored login. */
	home?: string;
	/** The API's base URL, for tests. */
	baseUrl?: string;
	/** How a 429 is waited out, for tests. */
	sleep?: GoDaddyApiOptions['sleep'];
	maxAttempts?: number;
	/** Where the write-only notice goes — `console.log` by default. */
	log?: (line: string) => void;
}

/** GoDaddy cannot list a zone through the records-by-name endpoints. */
export class GoDaddyZoneListingUnsupported extends Error {
	constructor(readonly domain: string) {
		super(
			`gkm reads GoDaddy records by name and type only — it never lists ` +
				`${domain}'s whole zone, so a token scoped to DNS updates is enough. ` +
				'Use readRecords(domain, [{ name, type }]) instead of getRecords.',
		);
		this.name = 'GoDaddyZoneListingUnsupported';
	}
}

/** A value compared the way DNS does: case-insensitive, no trailing dot. */
function normalize(value: string): string {
	return value.trim().replace(/\.$/, '').toLowerCase();
}

function managed(type: string): type is GoDaddyRecordType {
	return (GODADDY_MANAGED_TYPES as readonly string[]).includes(type);
}

/** A read GoDaddy refused: write-only, rather than a failure. */
function readDenied(error: unknown): boolean {
	return (
		error instanceof GoDaddyScopeMissing ||
		error instanceof GoDaddyApiAccessDenied
	);
}

export class GoDaddyProvider implements DnsProvider {
	readonly name = 'godaddy';
	private api: GoDaddyApi | null = null;
	/** Set once a read is refused: every write is then a blind PUT. */
	private writeOnly = false;

	constructor(private readonly options: GoDaddyProviderOptions = {}) {}

	/** Whether the token turned out unable to read records. */
	get readsDenied(): boolean {
		return this.writeOnly;
	}

	private async getApi(): Promise<GoDaddyApi> {
		if (this.api) return this.api;
		const credential =
			this.options.credential ??
			(await storedCredentials({
				env: this.options.env ?? process.env,
				...(this.options.home ? { home: this.options.home } : {}),
			}).get({ kind: 'godaddy' }));
		if (!credential) throw new MissingCredential('godaddy', undefined);
		this.api = new GoDaddyApi({
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
		if (!managed(type)) {
			throw new GoDaddyRecordNotAllowed(
				domain,
				type,
				name,
				'it is not a type gkm manages',
			);
		}
	}

	/** Never: the whole zone is not read. See {@link GoDaddyZoneListingUnsupported}. */
	async getRecords(domain: string): Promise<DnsRecord[]> {
		throw new GoDaddyZoneListingUnsupported(domain);
	}

	/**
	 * The records of exactly these names and types, one request each.
	 *
	 * @throws {DnsRecordsUnreadable} when the token may not read records
	 */
	async readRecords(
		domain: string,
		wanted: readonly DeleteDnsRecord[],
	): Promise<DnsRecord[]> {
		for (const { name, type } of wanted) this.assertManaged(domain, type, name);
		const api = await this.getApi();
		const found: DnsRecord[] = [];
		for (const { name, type } of wanted) {
			let records: GoDaddyRecord[];
			try {
				records = await api.getRecordSet(
					domain,
					type as GoDaddyRecordType,
					name,
				);
			} catch (error) {
				if (!readDenied(error)) throw error;
				this.writeOnly = true;
				throw new DnsRecordsUnreadable(
					this.name,
					domain,
					(error as Error).name,
				);
			}
			if (records.length === 0) continue;
			found.push({
				name,
				type,
				ttl: records[0]!.ttl ?? GODADDY_MIN_TTL,
				values: records.map((r) => r.data),
			});
		}
		return found;
	}

	/**
	 * Each record set to exactly its one value: read it, and write it only
	 * when it differs — or, with a token that cannot read, write it. Only the
	 * name and type of each record handed in is touched.
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
			const type = record.type as GoDaddyRecordType;
			let existing: GoDaddyRecord[] | undefined;
			if (!this.writeOnly) {
				try {
					existing = await api.getRecordSet(domain, type, record.name);
				} catch (error) {
					if (!readDenied(error)) throw error;
					this.writeOnly = true;
					(this.options.log ?? console.log)(
						`   ℹ The GoDaddy token cannot read ${domain}'s DNS records, so changes cannot be diffed: writing each record (idempotent).`,
					);
				}
			}
			if (existing) {
				const values = existing.map((r) => normalize(r.data));
				if (values.length === 1 && values[0] === normalize(record.value)) {
					results.push({ record, created: false, unchanged: true });
					continue;
				}
			}
			await api.replaceRecordSet(
				domain,
				type,
				record.name,
				[record.value],
				Math.max(record.ttl, GODADDY_MIN_TTL),
			);
			results.push({
				record,
				created: existing !== undefined && existing.length === 0,
				unchanged: false,
			});
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
			const type = record.type as GoDaddyRecordType;
			if (!this.writeOnly) {
				let existing: GoDaddyRecord[] | undefined;
				try {
					existing = await api.getRecordSet(domain, type, record.name);
				} catch (error) {
					if (!readDenied(error)) throw error;
					this.writeOnly = true;
				}
				if (existing && existing.length === 0) {
					results.push({ record, deleted: false, notFound: true });
					continue;
				}
			}
			try {
				await api.deleteRecordSet(domain, type, record.name);
			} catch (error) {
				// Write-only, nothing was read: a record that is not there is a 404.
				if (this.writeOnly && error instanceof GoDaddyDomainNotFound) {
					results.push({ record, deleted: false, notFound: true });
					continue;
				}
				throw error;
			}
			results.push({ record, deleted: true, notFound: false });
		}
		return results;
	}
}
