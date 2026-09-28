/**
 * Creating a deploy's DNS records, per domain and per provider.
 *
 * The Dokploy endpoint is `localhost`, so resolving the server's address needs
 * no network. Providers are the built-in `manual`, and a custom implementation
 * held in memory — the escape hatch a project uses for a registrar gkm does
 * not ship, and the only way to watch every result a provider can report.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	DeleteDnsRecord,
	DeleteResult,
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
	UpsertResult,
} from '../dns/DnsProvider';
import {
	createDnsRecords,
	createDnsRecordsForDomain,
	orchestrateDns,
	resolveHostnameToIp,
} from '../dns/index';
import { createEmptyState } from '../state';

/** A registrar that already holds `existing` and answers per the script. */
class InMemoryDns implements DnsProvider {
	readonly name = 'in-memory';
	readonly upserts: { domain: string; records: UpsertDnsRecord[] }[] = [];

	constructor(
		private readonly existing: string[] = [],
		private readonly options: { fail?: string; short?: boolean } = {},
	) {}

	async getRecords(): Promise<DnsRecord[]> {
		return [];
	}

	async upsertRecords(
		domain: string,
		records: UpsertDnsRecord[],
	): Promise<UpsertResult[]> {
		if (this.options.fail) throw new Error(this.options.fail);
		this.upserts.push({ domain, records });
		const results = records.map((record) => ({
			record,
			created: !this.existing.includes(record.name),
			unchanged: this.existing.includes(record.name),
		}));
		// A provider that answers for fewer records than it was given.
		return this.options.short ? results.slice(0, -1) : results;
	}

	async deleteRecords(
		_domain: string,
		records: DeleteDnsRecord[],
	): Promise<DeleteResult[]> {
		return records.map((record) => ({
			record,
			deleted: true,
			notFound: false,
		}));
	}
}

const ENDPOINT = 'http://localhost:3000';

describe('orchestrateDns', () => {
	let out: string[];
	const said = () => out.join('\n');

	beforeEach(() => {
		out = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(a.join(' '));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const hosts = (...pairs: [string, string][]) => new Map(pairs);

	it('does nothing without DNS config', async () => {
		await expect(
			orchestrateDns(hosts(['api', 'api.shop.com']), undefined, ENDPOINT),
		).resolves.toBeNull();
	});

	it('gives up, and says why, when the server address cannot be resolved', async () => {
		const result = await orchestrateDns(
			hosts(['api', 'api.shop.com']),
			{ 'shop.com': { provider: 'manual' } },
			'http://no-such-host.invalid',
		);

		expect(result).toBeNull();
		expect(said()).toContain('Failed to resolve server IP');
	});

	it('needs no records when no hostname is under a configured domain', async () => {
		const result = await orchestrateDns(
			hosts(['api', 'api.other.org']),
			{ 'shop.com': { provider: 'manual' } },
			ENDPOINT,
		);

		expect(result).toMatchObject({ records: [], success: true });
		expect(said()).toContain('No DNS records needed');
	});

	it('lists the records to add by hand for a manual domain', async () => {
		const result = await orchestrateDns(
			hosts(['api', 'api.shop.com'], ['web', 'shop.com']),
			{ 'shop.com': { provider: 'manual' } },
			ENDPOINT,
		);

		expect(result?.success).toBe(true);
		expect(result?.serverIp).toMatch(/^127\./);
		expect(result?.records.map((r) => r.subdomain)).toEqual(['api', '@']);
		expect(said()).toContain('Add these A records to your DNS provider');
		// Neither created nor existing: a person has to add them.
		expect(said()).toMatch(/│ api +│ A +│ 127\.[0-9.]+ +│ \? +│/);
	});

	it('creates records, keeps existing ones, and remembers both in state', async () => {
		const provider = new InMemoryDns(['@']);
		const state = createEmptyState('production', 'proj', 'env');

		const result = await orchestrateDns(
			hosts(['api', 'api.shop.com'], ['web', 'shop.com']),
			{ 'shop.com': { provider, ttl: 600 } },
			ENDPOINT,
			state,
		);

		expect(result?.success).toBe(true);
		expect(provider.upserts[0]?.records).toEqual([
			expect.objectContaining({ name: 'api', type: 'A', ttl: 600 }),
			expect.objectContaining({ name: '@', type: 'A', ttl: 600 }),
		]);
		expect(said()).toContain('Created 1 DNS record(s) for shop.com');
		expect(said()).toContain('1 record(s) already exist for shop.com');
		expect(said()).toMatch(/│ api +│ A +│ .+│ ✓ new +│/);
		expect(said()).toMatch(/│ @ +│ A +│ .+│ ✓ +│/);
		expect(Object.values(state.dnsRecords ?? {})).toEqual([
			expect.objectContaining({ domain: 'shop.com', name: 'api', ttl: 600 }),
			expect.objectContaining({ domain: 'shop.com', name: '@', ttl: 600 }),
		]);
	});

	it('handles each domain with its own provider', async () => {
		const shop = new InMemoryDns();
		const dev = new InMemoryDns();

		await orchestrateDns(
			hosts(['api', 'api.shop.com'], ['docs', 'docs.shop.dev']),
			{ 'shop.com': { provider: shop }, 'shop.dev': { provider: dev } },
			ENDPOINT,
		);

		expect(shop.upserts.map((u) => u.domain)).toEqual(['shop.com']);
		expect(dev.upserts.map((u) => u.domain)).toEqual(['shop.dev']);
		// The default TTL when the config names none.
		expect(dev.upserts[0]?.records[0]?.ttl).toBe(300);
	});

	it('reports a failure and lists what still needs adding', async () => {
		const result = await orchestrateDns(
			hosts(['api', 'api.shop.com']),
			{
				'shop.com': { provider: new InMemoryDns([], { fail: 'rate limited' }) },
			},
			ENDPOINT,
		);

		expect(result?.success).toBe(false);
		expect(result?.records[0]?.error).toBe('rate limited');
		expect(said()).toContain(
			'Failed to create DNS records for shop.com: rate limited',
		);
		expect(said()).toContain('1 record(s) failed for shop.com');
		expect(said()).toMatch(/│ api +│ A +│ .+│ ✗ +│/);
		expect(said()).toContain('Add these A records');
	});

	it('marks a record the provider gave no answer for as failed', async () => {
		const result = await orchestrateDns(
			hosts(['api', 'api.shop.com'], ['web', 'web.shop.com']),
			{ 'shop.com': { provider: new InMemoryDns([], { short: true }) } },
			ENDPOINT,
		);

		expect(result?.records.map((r) => r.error)).toEqual([
			undefined,
			'No result returned from provider',
		]);
		expect(result?.success).toBe(false);
	});

	it('reports a provider it cannot construct, for every record', async () => {
		const result = await orchestrateDns(
			hosts(['api', 'api.shop.com']),
			{ 'shop.com': { provider: 'cloudflare' } as never },
			ENDPOINT,
		);

		expect(result?.success).toBe(false);
		expect(said()).toContain(
			'Failed to create DNS provider for shop.com: Cloudflare DNS provider not yet implemented',
		);
	});

	it('accepts the legacy single-domain form', async () => {
		const provider = new InMemoryDns();

		await orchestrateDns(
			hosts(['api', 'api.shop.com']),
			{ provider, domain: 'shop.com' } as never,
			ENDPOINT,
		);

		expect(provider.upserts[0]?.domain).toBe('shop.com');
	});
});

describe('createDnsRecords (legacy)', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	const record = {
		hostname: 'api.shop.com',
		subdomain: 'api',
		type: 'A' as const,
		value: '1.2.3.4',
		appName: 'api',
	};

	it('creates records for the one domain the config names', async () => {
		const provider = new InMemoryDns();

		const [result] = await createDnsRecords([record], {
			provider,
			domain: 'shop.com',
		} as never);

		expect(result).toMatchObject({ created: true, existed: false });
	});

	it('refuses the multi-domain form', async () => {
		await expect(
			createDnsRecords([record], {
				'shop.com': { provider: 'manual' },
			} as never),
		).rejects.toThrow('createDnsRecords requires legacy DnsConfig');
	});

	it('leaves a manual domain’s records for a person to add', async () => {
		const [result] = await createDnsRecordsForDomain([record], 'shop.com', {
			provider: 'manual',
		});

		expect(result).toMatchObject({ created: false, existed: false });
	});
});

describe('resolveHostnameToIp', () => {
	it('names the host it could not resolve', async () => {
		await expect(resolveHostnameToIp('no-such-host.invalid')).rejects.toThrow(
			'Failed to resolve IP for no-such-host.invalid',
		);
	});
});
