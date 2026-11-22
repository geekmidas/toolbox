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
} from 'vitest';
import {
	CloudflareCredentialsInvalid,
	CloudflarePermissionMissing,
	CloudflareProvider,
	CloudflareRateLimited,
	type CloudflareRecord,
	CloudflareRecordNotAllowed,
	CloudflareZoneNotFound,
	fullName,
} from '../cloudflare';

/**
 * CloudflareProvider against an in-memory zone behind MSW: the v4 envelope,
 * `name.exact` lookups, and the writes it makes recorded in order.
 */
const BASE = 'https://cloudflare.test/client/v4';
const ZONE = 'example.com';
const ZONE_ID = 'zone-1';

let records: CloudflareRecord[] = [];
let writes: { method: string; body?: Record<string, unknown> }[] = [];
let nextId = 1;
let zoneLookups = 0;

const ok = (result: unknown, info?: unknown) =>
	HttpResponse.json({
		success: true,
		errors: [],
		result,
		...(info ? { result_info: info } : {}),
	});

const server = setupServer(
	http.get(`${BASE}/zones`, ({ request }) => {
		zoneLookups++;
		const name = new URL(request.url).searchParams.get('name');
		return ok(name === ZONE ? [{ id: ZONE_ID, name: ZONE }] : []);
	}),
	http.get(`${BASE}/zones/${ZONE_ID}/dns_records`, ({ request }) => {
		const query = new URL(request.url).searchParams;
		const type = query.get('type');
		const name = query.get('name.exact');
		const found = records.filter(
			(r) => r.type === type && (name === null || r.name === name),
		);
		return ok(found, { page: 1, total_pages: 1 });
	}),
	http.post(`${BASE}/zones/${ZONE_ID}/dns_records`, async ({ request }) => {
		const body = (await request.json()) as Record<string, unknown>;
		writes.push({ method: 'POST', body });
		const record = { id: `r${nextId++}`, ...body } as CloudflareRecord;
		records.push(record);
		return ok(record);
	}),
	http.patch(
		`${BASE}/zones/${ZONE_ID}/dns_records/:id`,
		async ({ request, params }) => {
			const body = (await request.json()) as Record<string, unknown>;
			writes.push({ method: 'PATCH', body });
			const i = records.findIndex((r) => r.id === params.id);
			records[i] = { ...records[i]!, ...body } as CloudflareRecord;
			return ok(records[i]);
		},
	),
	http.delete(`${BASE}/zones/${ZONE_ID}/dns_records/:id`, ({ params }) => {
		writes.push({ method: 'DELETE' });
		records = records.filter((r) => r.id !== params.id);
		return ok({ id: params.id });
	}),
);

const cloudflare = () =>
	new CloudflareProvider({
		credential: async () => ({ token: 'cf-token' }),
		baseUrl: BASE,
		sleep: async () => {},
	});

const seed = (record: Omit<CloudflareRecord, 'id'>) =>
	records.push({ id: `r${nextId++}`, ...record });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
	records = [];
	writes = [];
	nextId = 1;
	zoneLookups = 0;
});

describe('fullName', () => {
	it.each([
		['@', 'example.com'],
		['api', 'api.example.com'],
		['*', '*.example.com'],
		['api.example.com', 'api.example.com'],
		['_abc.files', '_abc.files.example.com'],
	])('%s → %s', (name, expected) => {
		expect(fullName(name, ZONE)).toBe(expected);
	});
});

describe('CloudflareProvider', () => {
	it('creates a record that is not there, unproxied unless asked', async () => {
		const results = await cloudflare().upsertRecords(ZONE, [
			{ name: 'api', type: 'A', ttl: 300, value: '203.0.113.10' },
		]);

		expect(results).toEqual([
			expect.objectContaining({ created: true, unchanged: false }),
		]);
		expect(writes).toEqual([
			{
				method: 'POST',
				body: {
					type: 'A',
					name: 'api.example.com',
					content: '203.0.113.10',
					ttl: 300,
					proxied: false,
				},
			},
		]);
	});

	it('proxies a record when asked, at the automatic TTL', async () => {
		await cloudflare().upsertRecords(ZONE, [
			{ name: '@', type: 'A', ttl: 300, value: '203.0.113.10', proxied: true },
		]);

		expect(records).toEqual([
			expect.objectContaining({
				name: 'example.com',
				proxied: true,
				ttl: 1,
			}),
		]);
	});

	it('leaves a record with its value and proxy alone', async () => {
		seed({
			type: 'A',
			name: 'api.example.com',
			content: '203.0.113.10',
			ttl: 1,
			proxied: true,
		});

		const results = await cloudflare().upsertRecords(ZONE, [
			{ name: 'api', type: 'A', ttl: 300, value: '203.0.113.10' },
		]);

		expect(results[0]).toMatchObject({ unchanged: true });
		expect(writes).toEqual([]);
	});

	it('keeps an existing proxy when the write does not mention it', async () => {
		seed({
			type: 'A',
			name: 'api.example.com',
			content: '203.0.113.9',
			ttl: 1,
			proxied: true,
		});

		await cloudflare().upsertRecords(ZONE, [
			{ name: 'api', type: 'A', ttl: 300, value: '203.0.113.10' },
		]);

		expect(records).toEqual([
			expect.objectContaining({ content: '203.0.113.10', proxied: true }),
		]);
	});

	it('takes a record out of the proxy when told to', async () => {
		seed({
			type: 'A',
			name: 'api.example.com',
			content: '203.0.113.10',
			ttl: 1,
			proxied: true,
		});

		const results = await cloudflare().upsertRecords(ZONE, [
			{
				name: 'api',
				type: 'A',
				ttl: 300,
				value: '203.0.113.10',
				proxied: false,
			},
		]);

		expect(results[0]).toMatchObject({ created: false, unchanged: false });
		expect(records).toEqual([
			expect.objectContaining({ proxied: false, ttl: 300 }),
		]);
	});

	it('leaves exactly one record of a name and type', async () => {
		seed({ type: 'A', name: 'api.example.com', content: '1.1.1.1', ttl: 300 });
		seed({ type: 'A', name: 'api.example.com', content: '2.2.2.2', ttl: 300 });

		await cloudflare().upsertRecords(ZONE, [
			{ name: 'api', type: 'A', ttl: 300, value: '203.0.113.10' },
		]);

		expect(records.map((r) => r.content)).toEqual(['203.0.113.10']);
	});

	it('writes an MX with its priority apart, and reads it back joined', async () => {
		const provider = cloudflare();
		await provider.upsertRecords(ZONE, [
			{
				name: '@',
				type: 'MX',
				ttl: 300,
				value: '10 inbound-smtp.eu-west-1.amazonaws.com',
			},
		]);

		expect(writes[0]!.body).toEqual({
			type: 'MX',
			name: 'example.com',
			content: 'inbound-smtp.eu-west-1.amazonaws.com',
			priority: 10,
			ttl: 300,
		});
		expect(
			await provider.readRecords(ZONE, [{ name: '@', type: 'MX' }]),
		).toEqual([
			{
				name: '@',
				type: 'MX',
				ttl: 300,
				values: ['10 inbound-smtp.eu-west-1.amazonaws.com'],
			},
		]);
	});

	it("puts mail's MX and DKIM records beside a proxied site on the same name, DNS-only", async () => {
		seed({
			type: 'A',
			name: 'example.com',
			content: '203.0.113.10',
			ttl: 1,
			proxied: true,
		});

		await cloudflare().upsertRecords(ZONE, [
			{
				name: '@',
				type: 'MX',
				ttl: 300,
				value: '10 inbound-smtp.eu-west-1.amazonaws.com',
				proxied: false,
			},
			{
				name: 'tok1._domainkey',
				type: 'CNAME',
				ttl: 300,
				value: 'tok1.dkim.amazonses.com',
				proxied: false,
			},
		]);

		expect(records.map((r) => [r.name, r.type, r.content, r.proxied])).toEqual([
			['example.com', 'A', '203.0.113.10', true],
			['example.com', 'MX', 'inbound-smtp.eu-west-1.amazonaws.com', undefined],
			[
				'tok1._domainkey.example.com',
				'CNAME',
				'tok1.dkim.amazonses.com',
				false,
			],
		]);
	});

	it('reads exactly the names asked for, with their proxy', async () => {
		seed({
			type: 'A',
			name: 'example.com',
			content: '203.0.113.10',
			ttl: 1,
			proxied: true,
		});
		seed({ type: 'A', name: 'api.example.com', content: '1.1.1.1', ttl: 300 });

		expect(
			await cloudflare().readRecords(ZONE, [
				{ name: '@', type: 'A' },
				{ name: 'web', type: 'A' },
			]),
		).toEqual([
			{
				name: '@',
				type: 'A',
				ttl: 300,
				values: ['203.0.113.10'],
				proxied: true,
			},
		]);
	});

	it('lists the zone by relative name', async () => {
		seed({ type: 'A', name: 'example.com', content: '1.1.1.1', ttl: 300 });
		seed({
			type: 'CNAME',
			name: 'www.example.com',
			content: 'x.net',
			ttl: 300,
		});

		const all = await cloudflare().getRecords(ZONE);

		expect(all.map((r) => `${r.name} ${r.type}`).sort()).toEqual([
			'@ A',
			'www CNAME',
		]);
	});

	it('deletes every record of a name and type, and says when there was none', async () => {
		seed({ type: 'A', name: 'api.example.com', content: '1.1.1.1', ttl: 300 });
		seed({ type: 'A', name: 'api.example.com', content: '2.2.2.2', ttl: 300 });

		const results = await cloudflare().deleteRecords(ZONE, [
			{ name: 'api', type: 'A' },
			{ name: 'web', type: 'A' },
		]);

		expect(results.map((r) => [r.deleted, r.notFound])).toEqual([
			[true, false],
			[false, true],
		]);
		expect(records).toEqual([]);
	});

	it('finds the zone once per provider', async () => {
		const provider = cloudflare();
		await provider.upsertRecords(ZONE, [
			{ name: 'a', type: 'A', ttl: 300, value: '1.1.1.1' },
			{ name: 'b', type: 'A', ttl: 300, value: '1.1.1.1' },
		]);

		expect(zoneLookups).toBe(1);
	});

	it('refuses a type gkm does not manage, before writing anything', async () => {
		await expect(
			cloudflare().upsertRecords(ZONE, [
				{ name: 'a', type: 'A', ttl: 300, value: '1.1.1.1' },
				{ name: '@', type: 'TXT', ttl: 300, value: 'v=spf1' },
			]),
		).rejects.toBeInstanceOf(CloudflareRecordNotAllowed);
		expect(writes).toEqual([]);
	});

	it('says when the zone is not in the account', async () => {
		await expect(
			cloudflare().readRecords('other.com', [{ name: '@', type: 'A' }]),
		).rejects.toBeInstanceOf(CloudflareZoneNotFound);
	});

	it('says when the token is refused', async () => {
		server.use(
			http.get(`${BASE}/zones`, () =>
				HttpResponse.json(
					{
						success: false,
						errors: [{ code: 10000, message: 'Authentication error' }],
						result: null,
					},
					{ status: 403 },
				),
			),
		);

		await expect(
			cloudflare().readRecords(ZONE, [{ name: '@', type: 'A' }]),
		).rejects.toBeInstanceOf(CloudflareCredentialsInvalid);
	});

	it('says when the token may not edit the zone', async () => {
		server.use(
			http.post(`${BASE}/zones/${ZONE_ID}/dns_records`, () =>
				HttpResponse.json(
					{
						success: false,
						errors: [{ code: 9999, message: 'not allowed' }],
						result: null,
					},
					{ status: 403 },
				),
			),
		);

		await expect(
			cloudflare().upsertRecords(ZONE, [
				{ name: 'a', type: 'A', ttl: 300, value: '1.1.1.1' },
			]),
		).rejects.toBeInstanceOf(CloudflarePermissionMissing);
	});

	it('waits out a 429, and gives up after a few', async () => {
		let calls = 0;
		server.use(
			http.get(`${BASE}/zones`, () => {
				calls++;
				return new HttpResponse(null, {
					status: 429,
					headers: { 'retry-after': '1' },
				});
			}),
		);

		await expect(
			cloudflare().readRecords(ZONE, [{ name: '@', type: 'A' }]),
		).rejects.toBeInstanceOf(CloudflareRateLimited);
		expect(calls).toBe(4);
	});
});
