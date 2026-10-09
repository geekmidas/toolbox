/**
 * GoDaddy's v1 DNS API, as gkm uses it: one record set — a name and a type —
 * at a time.
 *
 * - read: `GET /v1/domains/{domain}/records/{type}/{name}`
 * - write: `PUT /v1/domains/{domain}/records/{type}/{name}` with `[{ data, ttl }]`,
 *   which replaces that one name's records of that one type
 * - delete: `DELETE /v1/domains/{domain}/records/{type}/{name}`
 *
 * Never the zone-wide `PUT /v1/domains/{domain}/records`, which replaces every
 * record the domain has — mail, verification TXT records and all — and never
 * a domain or account endpoint (`GET /v1/domains`, `GET /v1/domains/{domain}`):
 * a token scoped to `domains.dns:update` alone is enough. A domain that is not
 * in the token's account is told apart by the records endpoint's own 404 or 422.
 *
 * Authenticated with a Personal Access Token — `Authorization: Bearer <token>`,
 * the API's one security scheme. GoDaddy allows about 60 requests a minute per
 * token; a 429 carries `retryAfterSec`, which is waited out a few times before
 * the run gives up with {@link GoDaddyRateLimited}. A 504 is retried the same
 * way. GoDaddy refuses a TTL under 600 seconds (a 422), so every write is
 * sent with at least that.
 */

import type { GoDaddyCredential } from '../../../deploy/credentials';
import { GkmError } from '../../../errors';

export const GODADDY_API_BASE = 'https://api.godaddy.com';

/** GoDaddy refuses a TTL below this. */
export const GODADDY_MIN_TTL = 600;

/** The record types gkm writes. Never MX, TXT, NS, SOA, SRV or CAA. */
export const GODADDY_MANAGED_TYPES = ['A', 'AAAA', 'CNAME'] as const;

export type GoDaddyRecordType = (typeof GODADDY_MANAGED_TYPES)[number];

/** One record as GoDaddy returns it. */
export interface GoDaddyRecord {
	type: string;
	name: string;
	data: string;
	ttl?: number;
}

/** GoDaddy's error body. */
interface GoDaddyErrorBody {
	code?: string;
	message?: string;
	retryAfterSec?: number;
}

/**
 * The token is good, and GoDaddy will not let it use the API: since 2024 the
 * Domains and DNS APIs answer only accounts with 10 or more domains, or a
 * Discount Domain Club Premier membership.
 */
export class GoDaddyApiAccessDenied extends GkmError {
	constructor(
		readonly domain: string,
		readonly detail?: string,
	) {
		super(
			`GoDaddy refused API access for ${domain} (403 ACCESS_DENIED${detail ? `: ${detail}` : ''}). ` +
				'GoDaddy only opens its DNS API to accounts with 10 or more domains, or ' +
				'with a Discount Domain Club Premier membership, so a valid token on a ' +
				'smaller account is refused. Either qualify the account, move the ' +
				"domain's DNS hosting to Route53 (provider: 'route53') or Cloudflare " +
				"by changing its nameservers at GoDaddy, or set provider: 'manual' " +
				'and create the records gkm prints yourself. (A scoped token without ' +
				'domains.dns:update is refused the same way — check its scopes too.)',
		);
		this.name = 'GoDaddyApiAccessDenied';
	}
}

/** The token lacks the scope a records call needs. */
export class GoDaddyScopeMissing extends GkmError {
	constructor(
		readonly method: string,
		readonly domain: string,
		readonly scope: string,
		readonly detail?: string,
	) {
		super(
			`GoDaddy refused ${method} on ${domain}'s DNS records (403${detail ? `: ${detail}` : ''}): ` +
				`the token lacks the ${scope} scope. Create a Personal Access Token ` +
				'in the GoDaddy developer dashboard with domains.dns:update — no ' +
				'domain or account scope is needed — and set GODADDY_API_TOKEN or ' +
				'run `gkm login --provider godaddy` again.',
		);
		this.name = 'GoDaddyScopeMissing';
	}
}

/** GoDaddy did not accept the token at all. */
export class GoDaddyCredentialsInvalid extends GkmError {
	constructor(readonly code?: string) {
		super(
			`GoDaddy did not accept the API token (401${code ? ` ${code}` : ''}). ` +
				'Check GODADDY_API_TOKEN, or run `gkm login --provider godaddy` ' +
				'again with a Personal Access Token from the GoDaddy developer ' +
				'dashboard that has not expired or been revoked.',
		);
		this.name = 'GoDaddyCredentialsInvalid';
	}
}

/** The domain is not in the account the token belongs to. */
export class GoDaddyDomainNotFound extends GkmError {
	constructor(
		readonly domain: string,
		readonly code?: string,
	) {
		super(
			`GoDaddy has no domain ${domain} in this token's account${code ? ` (${code})` : ''}. ` +
				'Check the root domain in dns, and that the token belongs to the account the domain is registered in.',
		);
		this.name = 'GoDaddyDomainNotFound';
	}
}

/** Still rate limited after waiting it out. */
export class GoDaddyRateLimited extends GkmError {
	constructor(
		readonly attempts: number,
		readonly retryAfterSec?: number,
	) {
		super(
			`GoDaddy is still rate limiting this token after ${attempts} attempts ` +
				'(429 TOO_MANY_REQUESTS — about 60 requests a minute are allowed). ' +
				`Wait${retryAfterSec ? ` ${retryAfterSec} seconds` : ' a minute'} and run it again; ` +
				'records already written are left as they are.',
		);
		this.name = 'GoDaddyRateLimited';
	}
}

/** Any other failure from GoDaddy. */
export class GoDaddyRequestFailed extends Error {
	constructor(
		readonly method: string,
		readonly path: string,
		readonly status: number,
		readonly code?: string,
		readonly detail?: string,
	) {
		super(
			`GoDaddy answered ${method} ${path} with ${status}${code ? ` ${code}` : ''}` +
				`${detail ? `: ${detail}` : ''}.` +
				(status === 422
					? ' A name with a CNAME cannot also have an A or AAAA record, and the reverse — remove the other one first.'
					: ''),
		);
		this.name = 'GoDaddyRequestFailed';
	}
}

/**
 * A write gkm was about to make to a record type it never manages, or to a
 * name it was not asked for.
 */
export class GoDaddyRecordNotAllowed extends GkmError {
	constructor(
		readonly domain: string,
		readonly type: string,
		readonly recordName: string,
		readonly reason: string,
	) {
		super(
			`Refused to change the ${type} record '${recordName}' on ${domain}: ${reason}. ` +
				'gkm only ever writes the A, AAAA and CNAME records of the hosts it serves.',
		);
		this.name = 'GoDaddyRecordNotAllowed';
	}
}

export interface GoDaddyApiOptions {
	credential: GoDaddyCredential;
	/** The API's base URL. GoDaddy's production API by default. */
	baseUrl?: string;
	/** How a 429 or 504 is waited out — `setTimeout` by default; tests pass their own. */
	sleep?: (ms: number) => Promise<void>;
	/** How many times one request is sent before a 429 or 504 is final. Default 4. */
	maxAttempts?: number;
}

/** A record name GoDaddy's path takes: `@` for the apex, else relative. */
function isRecordName(name: string): boolean {
	return (
		name === '@' ||
		/^(\*\.)?[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?(\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?)*$/i.test(
			name,
		)
	);
}

/** The client. Every method touches one record set, by type and name. */
export class GoDaddyApi {
	private readonly baseUrl: string;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly maxAttempts: number;
	private readonly authorization: string;
	/** Whether a read has succeeded: a later 403 is then the token's scope. */
	private readSucceeded = false;

	constructor(options: GoDaddyApiOptions) {
		this.baseUrl = (options.baseUrl ?? GODADDY_API_BASE).replace(/\/$/, '');
		this.sleep =
			options.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.maxAttempts = options.maxAttempts ?? 4;
		this.authorization = `Bearer ${options.credential.token}`;
	}

	/** The records of one name and type — empty when there are none. */
	async getRecordSet(
		domain: string,
		type: GoDaddyRecordType,
		name: string,
	): Promise<GoDaddyRecord[]> {
		this.guard(domain, type, name);
		const records = await this.request<GoDaddyRecord[]>(
			'GET',
			domain,
			this.recordPath(domain, type, name),
		);
		return Array.isArray(records) ? records : [];
	}

	/** Replace one name's records of one type with `values`. */
	async replaceRecordSet(
		domain: string,
		type: GoDaddyRecordType,
		name: string,
		values: readonly string[],
		ttl: number,
	): Promise<void> {
		this.guard(domain, type, name);
		await this.request(
			'PUT',
			domain,
			this.recordPath(domain, type, name),
			values.map((data) => ({
				data,
				ttl: Math.max(ttl, GODADDY_MIN_TTL),
			})),
		);
	}

	/** Delete one name's records of one type. */
	async deleteRecordSet(
		domain: string,
		type: GoDaddyRecordType,
		name: string,
	): Promise<void> {
		this.guard(domain, type, name);
		await this.request('DELETE', domain, this.recordPath(domain, type, name));
	}

	private recordPath(domain: string, type: string, name: string): string {
		return `/v1/domains/${encodeURIComponent(domain)}/records/${type}/${encodeURIComponent(name)}`;
	}

	/** Only A, AAAA and CNAME, at a real record name. */
	private guard(domain: string, type: string, name: string): void {
		if (!(GODADDY_MANAGED_TYPES as readonly string[]).includes(type)) {
			throw new GoDaddyRecordNotAllowed(
				domain,
				type,
				name,
				'it is not a type gkm manages',
			);
		}
		if (!isRecordName(name)) {
			throw new GoDaddyRecordNotAllowed(
				domain,
				type,
				name,
				'it is not a record name relative to the domain',
			);
		}
	}

	private async request<T = unknown>(
		method: 'GET' | 'PUT' | 'DELETE',
		domain: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		let retryAfterSec: number | undefined;
		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			const response = await fetch(`${this.baseUrl}${path}`, {
				method,
				headers: {
					Authorization: this.authorization,
					Accept: 'application/json',
					...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
				},
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});

			if (response.ok) {
				if (method === 'GET') this.readSucceeded = true;
				if (response.status === 204) return undefined as T;
				const text = await response.text();
				return (text ? JSON.parse(text) : undefined) as T;
			}

			const error = await errorBody(response);
			if (response.status === 504 && attempt < this.maxAttempts) {
				await this.sleep(Math.min(2 ** attempt * 1000, 30_000));
				continue;
			}
			if (response.status === 429) {
				retryAfterSec = error.retryAfterSec;
				if (attempt === this.maxAttempts) break;
				// GoDaddy says how long; without it, back off exponentially.
				const waitMs =
					retryAfterSec !== undefined
						? Math.min(retryAfterSec, 60) * 1000
						: Math.min(2 ** attempt * 1000, 60_000);
				await this.sleep(waitMs);
				continue;
			}
			if (response.status === 401) {
				throw new GoDaddyCredentialsInvalid(error.code);
			}
			if (response.status === 403) {
				// The account restriction says ACCESS_DENIED; a scoped token that
				// may not make this call says so, or — after a read went
				// through — can only be that.
				const scoped =
					/scope/i.test(`${error.code ?? ''} ${error.message ?? ''}`) ||
					(method !== 'GET' && this.readSucceeded);
				if (scoped) {
					throw new GoDaddyScopeMissing(
						method,
						domain,
						method === 'GET' ? 'DNS records read' : 'domains.dns:update',
						error.message ?? error.code,
					);
				}
				throw new GoDaddyApiAccessDenied(domain, error.message ?? error.code);
			}
			if (response.status === 404) {
				throw new GoDaddyDomainNotFound(domain, error.code);
			}
			if (
				response.status === 422 &&
				/domain/i.test(error.code ?? '') &&
				!/record/i.test(`${error.code ?? ''} ${error.message ?? ''}`)
			) {
				throw new GoDaddyDomainNotFound(domain, error.code);
			}
			throw new GoDaddyRequestFailed(
				method,
				path,
				response.status,
				error.code,
				error.message,
			);
		}
		throw new GoDaddyRateLimited(this.maxAttempts, retryAfterSec);
	}
}

async function errorBody(response: Response): Promise<GoDaddyErrorBody> {
	try {
		const parsed = (await response.json()) as GoDaddyErrorBody;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}
