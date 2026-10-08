import { realpathSync } from 'node:fs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { storeGoDaddyToken } from '../../auth/credentials';
import {
	createDnsProvider,
	DnsRecordsUnreadable,
} from '../../target/dokploy/dns/DnsProvider';
import {
	GoDaddyProvider,
	GoDaddyZoneListingUnsupported,
} from '../../target/dokploy/dns/GoDaddyProvider';
import {
	GoDaddyApiAccessDenied,
	GoDaddyCredentialsInvalid,
	GoDaddyDomainNotFound,
	GoDaddyRateLimited,
	GoDaddyRecordNotAllowed,
	GoDaddyScopeMissing,
} from '../../target/dokploy/dns/godaddy-api';
import { createDnsRecordsForDomain } from '../../target/dokploy/dns/index';
import { MissingCredential } from '../credentials';

/**
 * The GoDaddy DNS provider against GoDaddy's v1 records API, stood in for by
 * MSW with the shapes of its OpenAPI spec: a Personal Access Token as
 * `Authorization: Bearer`, `DNSRecord` arrays on a read, `DNSRecordCreateTypeName`
 * arrays on a write (204), and `{ code, message }` / `{ code, retryAfterSec }`
 * error bodies.
 */

const API = 'https://api.godaddy.com';
const DOMAIN = 'example.com';
const TOKEN = 'gd-pat-test';

interface Recorded {
	method: string;
	path: string;
	body?: unknown;
}

/** The zone: `<type> <name>` → its records. */
let zone: Map<string, { data: string; ttl: number }[]>;
let requests: Recorded[];
/** Overrides for one method, answered before the zone is consulted. */
let answer: {
	GET?: () => Response | undefined;
	PUT?: () => Response | undefined;
	DELETE?: () => Response | undefined;
};

const error = (status: number, body: Record<string, unknown>) =>
	HttpResponse.json(body, { status });

const server = setupServer(
	http.all(`${API}/*`, async ({ request }) => {
		const url = new URL(request.url);
		const body = request.method === 'PUT' ? await request.json() : undefined;
		requests.push({
			method: request.method,
			path: decodeURIComponent(url.pathname),
			...(body !== undefined ? { body } : {}),
		});
		if (request.headers.get('Authorization') !== `Bearer ${TOKEN}`) {
			return error(401, {
				code: 'UNABLE_TO_AUTHENTICATE',
				message: 'Unable to authenticate',
			});
		}
		const overridden =
			answer[request.method as keyof typeof answer]?.() ?? undefined;
		if (overridden) return overridden;

		const match = url.pathname.match(
			/^\/v1\/domains\/([^/]+)\/records\/([A-Z]+)\/([^/]+)$/,
		);
		if (!match) return error(404, { code: 'NOT_FOUND', message: 'nope' });
		const [, domain, type, rawName] = match;
		const name = decodeURIComponent(rawName!);
		if (domain !== DOMAIN) {
			return error(404, {
				code: 'UNKNOWN_DOMAIN',
				message: `The given domain is not registered, or does not have a zone file`,
			});
		}
		const key = `${type} ${name}`;
		if (request.method === 'GET') {
			return HttpResponse.json(
				(zone.get(key) ?? []).map((r) => ({ type, name, ...r })),
			);
		}
		if (request.method === 'PUT') {
			const records = body as { data: string; ttl: number }[];
			if (records.some((r) => r.ttl < 600)) {
				return error(422, {
					code: 'INVALID_BODY',
					message: 'ttl must be at least 600',
				});
			}
			zone.set(key, records);
			return new HttpResponse(null, { status: 204 });
		}
		if (request.method === 'DELETE') {
			if (!zone.has(key)) {
				return error(404, { code: 'NOT_FOUND', message: 'No record' });
			}
			zone.delete(key);
			return new HttpResponse(null, { status: 204 });
		}
		return error(400, { code: 'BAD_REQUEST', message: request.method });
	}),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
	zone = new Map([
		['A @', [{ data: '198.51.100.7', ttl: 3600 }]],
		['MX @', [{ data: 'mail.example.com', ttl: 3600 }]],
		['TXT @', [{ data: 'v=spf1 -all', ttl: 3600 }]],
	]);
	requests = [];
	answer = {};
});
afterEach(() => server.resetHandlers());

const sleeps: number[] = [];
const provider = (
	options: ConstructorParameters<typeof GoDaddyProvider>[0] = {},
) =>
	new GoDaddyProvider({
		credential: { token: TOKEN },
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		log: () => {},
		...options,
	});

describe('GoDaddyProvider', () => {
	it('reads one record set by type and name, with the token as Bearer', async () => {
		const records = await provider().readRecords(DOMAIN, [
			{ name: '@', type: 'A' },
			{ name: 'api', type: 'A' },
		]);

		expect(records).toEqual([
			{ name: '@', type: 'A', ttl: 3600, values: ['198.51.100.7'] },
		]);
		expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
			'GET /v1/domains/example.com/records/A/@',
			'GET /v1/domains/example.com/records/A/api',
		]);
	});

	it('never lists the zone', async () => {
		await expect(provider().getRecords(DOMAIN)).rejects.toBeInstanceOf(
			GoDaddyZoneListingUnsupported,
		);
		expect(requests).toEqual([]);
	});

	it('creates a missing record with one PUT of [{ data, ttl }]', async () => {
		const [result] = await provider().upsertRecords(DOMAIN, [
			{ name: 'api', type: 'A', value: '203.0.113.10', ttl: 600 },
		]);

		expect(result).toMatchObject({ created: true, unchanged: false });
		expect(requests.filter((r) => r.method === 'PUT')).toEqual([
			{
				method: 'PUT',
				path: '/v1/domains/example.com/records/A/api',
				body: [{ data: '203.0.113.10', ttl: 600 }],
			},
		]);
	});

	it('updates a record with another value', async () => {
		const [result] = await provider().upsertRecords(DOMAIN, [
			{ name: '@', type: 'A', value: '203.0.113.10', ttl: 600 },
		]);

		expect(result).toMatchObject({ created: false, unchanged: false });
		expect(zone.get('A @')).toEqual([{ data: '203.0.113.10', ttl: 600 }]);
	});

	it('leaves a record that already has the value alone — no PUT', async () => {
		const [result] = await provider().upsertRecords(DOMAIN, [
			{ name: '@', type: 'A', value: '198.51.100.7', ttl: 600 },
		]);

		expect(result).toMatchObject({ unchanged: true });
		expect(requests.map((r) => r.method)).toEqual(['GET']);
	});

	it('writes at least the 600-second TTL GoDaddy accepts', async () => {
		await provider().upsertRecords(DOMAIN, [
			{ name: 'api', type: 'A', value: '203.0.113.10', ttl: 300 },
		]);

		expect(zone.get('A api')).toEqual([{ data: '203.0.113.10', ttl: 600 }]);
	});

	it('only ever writes the names and types it was asked for', async () => {
		await provider().upsertRecords(DOMAIN, [
			{ name: 'api', type: 'A', value: '203.0.113.10', ttl: 600 },
			{ name: 'www', type: 'CNAME', value: 'server.example.com', ttl: 600 },
		]);

		const writes = requests
			.filter((r) => r.method !== 'GET')
			.map((r) => `${r.method} ${r.path}`);
		expect(writes).toEqual([
			'PUT /v1/domains/example.com/records/A/api',
			'PUT /v1/domains/example.com/records/CNAME/www',
		]);
		// Mail and the SPF record are as they were.
		expect(zone.get('MX @')).toEqual([{ data: 'mail.example.com', ttl: 3600 }]);
		expect(zone.get('TXT @')).toEqual([{ data: 'v=spf1 -all', ttl: 3600 }]);
	});

	it('refuses an MX, TXT or NS record before sending anything', async () => {
		for (const type of ['MX', 'TXT', 'NS', 'SOA'] as const) {
			await expect(
				provider().upsertRecords(DOMAIN, [
					{ name: 'api', type: 'A', value: '203.0.113.10', ttl: 600 },
					{ name: '@', type, value: 'x', ttl: 600 },
				]),
			).rejects.toBeInstanceOf(GoDaddyRecordNotAllowed);
			await expect(
				provider().deleteRecords(DOMAIN, [{ name: '@', type }]),
			).rejects.toBeInstanceOf(GoDaddyRecordNotAllowed);
		}
		expect(requests).toEqual([]);
	});

	it('turns 403 ACCESS_DENIED on a read and a write into the API-access error', async () => {
		const denied = () =>
			error(403, {
				code: 'ACCESS_DENIED',
				message: 'Authenticated user is not allowed access',
			});
		answer = { GET: denied, PUT: denied };

		const failure = await provider()
			.upsertRecords(DOMAIN, [
				{ name: 'api', type: 'A', value: '203.0.113.10', ttl: 600 },
			])
			.catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(GoDaddyApiAccessDenied);
		expect((failure as Error).message).toContain('10 or more domains');
		expect((failure as Error).message).toContain("provider: 'manual'");
	});

	it('turns a 403 on PUT after a successful GET into GoDaddyScopeMissing', async () => {
		answer = {
			PUT: () =>
				error(403, {
					code: 'ACCESS_DENIED',
					message: 'Authenticated user is not allowed access',
				}),
		};

		const failure = await provider()
			.upsertRecords(DOMAIN, [
				{ name: 'api', type: 'A', value: '203.0.113.10', ttl: 600 },
			])
			.catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(GoDaddyScopeMissing);
		expect((failure as GoDaddyScopeMissing).method).toBe('PUT');
		expect((failure as GoDaddyScopeMissing).scope).toBe('domains.dns:update');
	});

	it('writes blind when the token may update and not read', async () => {
		answer = {
			GET: () =>
				error(403, { code: 'ACCESS_DENIED', message: 'Insufficient scope' }),
		};
		const lines: string[] = [];
		const p = provider({ log: (line) => lines.push(line) });

		const results = await p.upsertRecords(DOMAIN, [
			{ name: 'api', type: 'A', value: '203.0.113.10', ttl: 600 },
			{ name: '@', type: 'A', value: '203.0.113.10', ttl: 600 },
		]);

		expect(results.map((r) => r.unchanged)).toEqual([false, false]);
		expect(lines.join('\n')).toContain('cannot read');
		// One refused read, then PUTs only.
		expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
			'GET /v1/domains/example.com/records/A/api',
			'PUT /v1/domains/example.com/records/A/api',
			'PUT /v1/domains/example.com/records/A/@',
		]);
		expect(zone.get('A @')).toEqual([{ data: '203.0.113.10', ttl: 600 }]);
	});

	it('says a read was refused, for the caller to fall back on writing', async () => {
		answer = {
			GET: () =>
				error(403, { code: 'ACCESS_DENIED', message: 'Insufficient scope' }),
		};

		await expect(
			provider().readRecords(DOMAIN, [{ name: 'api', type: 'A' }]),
		).rejects.toBeInstanceOf(DnsRecordsUnreadable);
	});

	it('turns a 401 into GoDaddyCredentialsInvalid', async () => {
		await expect(
			provider({ credential: { token: 'wrong' } }).readRecords(DOMAIN, [
				{ name: 'api', type: 'A' },
			]),
		).rejects.toBeInstanceOf(GoDaddyCredentialsInvalid);
	});

	it('turns a 404 for the domain into GoDaddyDomainNotFound', async () => {
		const failure = await provider()
			.upsertRecords('not-mine.com', [
				{ name: 'api', type: 'A', value: '203.0.113.10', ttl: 600 },
			])
			.catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(GoDaddyDomainNotFound);
		expect((failure as GoDaddyDomainNotFound).domain).toBe('not-mine.com');
	});

	it('waits out a 429 for retryAfterSec, then carries on', async () => {
		let limited = 1;
		answer = {
			GET: () =>
				limited-- > 0
					? error(429, {
							code: 'TOO_MANY_REQUESTS',
							message: 'Too many requests',
							retryAfterSec: 2,
						})
					: undefined,
		};
		sleeps.length = 0;

		const records = await provider().readRecords(DOMAIN, [
			{ name: '@', type: 'A' },
		]);

		expect(records).toHaveLength(1);
		expect(sleeps).toEqual([2000]);
	});

	it('gives up with GoDaddyRateLimited after a few 429s', async () => {
		answer = {
			GET: () =>
				error(429, {
					code: 'TOO_MANY_REQUESTS',
					message: 'Too many requests',
					retryAfterSec: 30,
				}),
		};

		const failure = await provider({ maxAttempts: 3 })
			.readRecords(DOMAIN, [{ name: '@', type: 'A' }])
			.catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(GoDaddyRateLimited);
		expect(requests).toHaveLength(3);
	});

	it('retries a 504 gateway timeout', async () => {
		let timeouts = 1;
		answer = {
			GET: () =>
				timeouts-- > 0
					? error(504, { code: 'GATEWAY_TIMEOUT', message: 'timeout' })
					: undefined,
		};

		const records = await provider().readRecords(DOMAIN, [
			{ name: '@', type: 'A' },
		]);

		expect(records).toHaveLength(1);
		expect(requests).toHaveLength(2);
	});

	it('deletes only a record set that is there', async () => {
		const results = await provider().deleteRecords(DOMAIN, [
			{ name: '@', type: 'A' },
			{ name: 'gone', type: 'CNAME' },
		]);

		expect(results.map((r) => [r.deleted, r.notFound])).toEqual([
			[true, false],
			[false, true],
		]);
		expect(requests.filter((r) => r.method === 'DELETE')).toEqual([
			{ method: 'DELETE', path: '/v1/domains/example.com/records/A/@' },
		]);
	});
});

describe('GoDaddyProvider credentials', () => {
	let home: string;

	beforeEach(async () => {
		home = realpathSync(await createTempDir('gkm-godaddy-home-'));
	});
	afterEach(async () => {
		await cleanupDir(home);
	});

	it('reads GODADDY_API_TOKEN from the environment', async () => {
		const p = new GoDaddyProvider({
			env: { GODADDY_API_TOKEN: TOKEN },
			home,
		});

		await expect(
			p.readRecords(DOMAIN, [{ name: '@', type: 'A' }]),
		).resolves.toHaveLength(1);
	});

	it('reads the token gkm login stored', async () => {
		await storeGoDaddyToken(TOKEN, { home });
		const p = new GoDaddyProvider({ env: {}, home });

		await expect(
			p.readRecords(DOMAIN, [{ name: '@', type: 'A' }]),
		).resolves.toHaveLength(1);
	});

	it('says how to supply one when there is none', async () => {
		const failure = await new GoDaddyProvider({ env: {}, home })
			.readRecords(DOMAIN, [{ name: '@', type: 'A' }])
			.catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(MissingCredential);
		expect((failure as Error).message).toContain('GODADDY_API_TOKEN');
		expect((failure as Error).message).toContain(
			'gkm login --provider godaddy',
		);
		expect(requests).toEqual([]);
	});
});

describe("the Dokploy target's DNS step, through GoDaddy", () => {
	beforeEach(() => {
		vi.stubEnv('GODADDY_API_TOKEN', TOKEN);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("resolves provider: 'godaddy' from dns to the GoDaddy provider", async () => {
		const resolved = await createDnsProvider({
			config: { provider: 'godaddy' },
		});

		expect(resolved).toBeInstanceOf(GoDaddyProvider);
	});

	it("writes each app's A record through the same DnsProvider interface", async () => {
		const records = await createDnsRecordsForDomain(
			[
				{
					hostname: 'api.example.com',
					subdomain: 'api',
					type: 'A',
					value: '203.0.113.10',
					appName: 'api',
				},
				{
					hostname: 'example.com',
					subdomain: '@',
					type: 'A',
					value: '198.51.100.7',
					appName: 'web',
				},
			],
			DOMAIN,
			{ provider: 'godaddy' },
		);

		expect(records.map((r) => [r.appName, r.created, r.existed])).toEqual([
			['api', true, false],
			['web', false, true],
		]);
		// The apex already pointed there: only the API's record was written.
		expect(
			requests.filter((r) => r.method === 'PUT').map((r) => r.path),
		).toEqual(['/v1/domains/example.com/records/A/api']);
		expect(zone.get('A api')).toEqual([{ data: '203.0.113.10', ttl: 600 }]);
	});
});
