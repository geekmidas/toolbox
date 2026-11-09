import type {
	DeleteDnsRecord,
	DeleteResult,
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
	UpsertResult,
} from '@geekmidas/edge/dns';
import { describe, expect, it } from 'vitest';
import { writeProviderDns } from '../dnsWriter';

/** One zone, in memory, recording each write. */
class Zone implements DnsProvider {
	readonly name = 'memory';
	readonly records: DnsRecord[] = [];
	readonly writes: string[] = [];
	async getRecords(): Promise<DnsRecord[]> {
		return this.records.map((r) => ({ ...r, values: [...r.values] }));
	}
	async upsertRecords(
		_domain: string,
		records: UpsertDnsRecord[],
	): Promise<UpsertResult[]> {
		for (const r of records) {
			this.writes.push(`${r.type} ${r.name} ${r.value}`);
			const existing = this.records.find(
				(z) => z.name === r.name && z.type === r.type,
			);
			if (existing) existing.values = [r.value];
			else
				this.records.push({
					name: r.name,
					type: r.type,
					ttl: r.ttl,
					values: [r.value],
				});
		}
		return records.map((record) => ({
			record,
			created: true,
			unchanged: false,
		}));
	}
	async deleteRecords(
		_domain: string,
		records: DeleteDnsRecord[],
	): Promise<DeleteResult[]> {
		return records.map((record) => ({
			record,
			deleted: false,
			notFound: true,
		}));
	}
}

/** Route53 and `manual` need no token. */
const credentials = { get: async () => undefined } as never;

describe("a provider's DNS records", () => {
	it('writes each through its domain’s provider, once, and reports what it could not', async () => {
		const zone = new Zone();
		const lines: string[] = [];
		const write = () =>
			writeProviderDns(
				[
					{
						host: 'files.example.com',
						type: 'CNAME',
						value: 'd1.cloudfront.net.',
					},
					{
						host: '_abc.files.example.com.',
						type: 'CNAME',
						value: '_x.acm-validations.aws.',
					},
					{
						host: 'files.other.org',
						type: 'CNAME',
						value: 'd2.cloudfront.net',
					},
				],
				{
					workspace: {
						dns: { 'example.com': { provider: 'route53' } } as never,
					},
					stage: 'prod',
					dryRun: false,
					credentials,
					providerFor: async () => zone,
					log: (line) => lines.push(line),
				},
			);

		const result = await write();

		expect([...zone.writes].sort()).toEqual([
			'CNAME _abc.files _x.acm-validations.aws',
			'CNAME files d1.cloudfront.net',
		]);
		expect(result.manual).toEqual(['files.other.org']);
		expect(lines).toContain(
			'   create at its DNS host: files.other.org CNAME d2.cloudfront.net',
		);

		// A record holding its value is left alone.
		zone.writes.length = 0;
		await write();
		expect(zone.writes).toEqual([]);
	});

	it('writes MX records through the same path, as "<priority> <host>"', async () => {
		const zone = new Zone();
		// Someone else's records at the same names: never deleted for an MX.
		zone.records.push(
			{ name: '*', type: 'CNAME', ttl: 300, values: ['shop.example.com'] },
			{ name: '@', type: 'MX', ttl: 300, values: ['20 mail.example.com'] },
		);
		const lines: string[] = [];
		const mx = (host: string) => ({
			host,
			type: 'MX' as const,
			value: 'inbound-smtp.eu-west-1.amazonaws.com.',
			priority: 10,
		});
		const write = () =>
			writeProviderDns(
				[mx('example.com'), mx('*.example.com'), mx('fixwell.example')],
				{
					workspace: {
						dns: { 'example.com': { provider: 'route53' } } as never,
					},
					stage: 'prod',
					dryRun: false,
					credentials,
					providerFor: async () => zone,
					log: (line) => lines.push(line),
				},
			);

		const result = await write();

		expect([...zone.writes].sort()).toEqual([
			'MX * 10 inbound-smtp.eu-west-1.amazonaws.com',
			'MX @ 10 inbound-smtp.eu-west-1.amazonaws.com',
		]);
		expect(zone.records).toContainEqual({
			name: '*',
			type: 'CNAME',
			ttl: 300,
			values: ['shop.example.com'],
		});
		expect(lines.some((l) => l.includes('20 mail.example.com → 10'))).toBe(
			true,
		);
		expect(result.manual).toEqual(['fixwell.example']);
		expect(lines).toContain(
			'   create at its DNS host: fixwell.example MX 10 inbound-smtp.eu-west-1.amazonaws.com',
		);

		// Holding their values, they are left alone.
		zone.writes.length = 0;
		lines.length = 0;
		await write();
		expect(zone.writes).toEqual([]);
		expect(lines.filter((l) => l.includes('up to date'))).toHaveLength(2);
	});

	it('prints a manual domain’s MX records with their priority, and writes none', async () => {
		const lines: string[] = [];
		const result = await writeProviderDns(
			[
				{
					host: 'fixwell.example',
					type: 'MX',
					value: 'inbound-smtp.eu-west-1.amazonaws.com',
					priority: 10,
				},
				{
					host: '*.fixwell.example',
					type: 'MX',
					value: 'inbound-smtp.eu-west-1.amazonaws.com',
					priority: 10,
				},
			],
			{
				workspace: {
					dns: { 'fixwell.example': { provider: 'manual' } } as never,
				},
				stage: 'prod',
				dryRun: false,
				credentials,
				log: (line) => lines.push(line),
			},
		);

		expect(result.manual).toEqual(['*.fixwell.example', 'fixwell.example']);
		expect(lines.filter((l) => l.includes(' MX '))).toEqual([
			expect.stringMatching(
				/^ {5}fixwell\.example +MX +10 inbound-smtp\.eu-west-1\.amazonaws\.com {2}\(TTL \d+\)$/,
			),
			expect.stringMatching(
				/^ {5}\*\.fixwell\.example +MX +10 inbound-smtp\.eu-west-1\.amazonaws\.com {2}\(TTL \d+\)$/,
			),
		]);
	});

	it('prints a manual domain’s records and writes none', async () => {
		const result = await writeProviderDns(
			[
				{
					host: 'files.example.com',
					type: 'CNAME',
					value: 'd1.cloudfront.net',
				},
			],
			{
				workspace: { dns: { 'example.com': { provider: 'manual' } } as never },
				stage: 'prod',
				dryRun: false,
				credentials,
				log: () => {},
			},
		);

		expect(result.manual).toEqual(['files.example.com']);
	});

	it('writes nothing on a dry run', async () => {
		const zone = new Zone();
		await writeProviderDns(
			[
				{
					host: 'files.example.com',
					type: 'CNAME',
					value: 'd1.cloudfront.net',
				},
			],
			{
				workspace: {
					dns: { 'example.com': { provider: 'route53' } } as never,
				},
				stage: 'prod',
				dryRun: true,
				credentials,
				providerFor: async () => zone,
				log: () => {},
			},
		);
		expect(zone.writes).toEqual([]);
	});
});
