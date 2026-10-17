import { describe, expect, it } from 'vitest';
import type {
	DeleteDnsRecord,
	DeleteResult,
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
	UpsertResult,
} from '../../target/dokploy/dns/DnsProvider';
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
