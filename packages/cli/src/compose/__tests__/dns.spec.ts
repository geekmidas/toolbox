import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initStageSecrets, toEmbeddableSecrets } from '../../secrets/storage';
import type {
	DeleteDnsRecord,
	DeleteResult,
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
	UpsertResult,
} from '../../target/dokploy/dns/DnsProvider';
import { GoDaddyProvider } from '../../target/dokploy/dns/GoDaddyProvider';
import { resolveEnvVar } from '../../target/dokploy/env-resolver';
import type { WorkspaceDnsConfig } from '../../workspace/types';
import {
	applyStackDns,
	checkStackDns,
	HostNotPointingAtServer,
	planStackDns,
	requiredServerAddress,
	ServerAddressInvalid,
	ServerAddressMissing,
	serverAddress,
} from '../dns';

/**
 * A compose stage's DNS step: the plan its hosts get, the records it writes
 * through a provider — a recording one, and GoDaddy's API through MSW — and
 * the check every deploy runs, with an injected resolver.
 */

const IPV4 = '203.0.113.10';
const IPV6 = '2001:db8::10';
const HOSTS = [
	'shop.example.com',
	'api.shop.example.com',
	'auth.shop.example.com',
];

/** A provider that keeps a zone in memory and records every write. */
class RecordingDns implements DnsProvider {
	readonly name = 'recording';
	readonly writes: string[] = [];
	constructor(readonly zone: DnsRecord[] = []) {}
	async getRecords(): Promise<DnsRecord[]> {
		return this.zone;
	}
	async upsertRecords(
		_domain: string,
		records: UpsertDnsRecord[],
	): Promise<UpsertResult[]> {
		for (const r of records) {
			this.writes.push(`put ${r.type} ${r.name} ${r.value} ${r.ttl}`);
			const existing = this.zone.find(
				(z) => z.name === r.name && z.type === r.type,
			);
			if (existing) existing.values = [r.value];
			else
				this.zone.push({
					name: r.name,
					type: r.type,
					ttl: r.ttl,
					values: [r.value],
				});
		}
		return records.map((record) => ({
			record,
			created: false,
			unchanged: false,
		}));
	}
	async deleteRecords(
		_domain: string,
		records: DeleteDnsRecord[],
	): Promise<DeleteResult[]> {
		for (const r of records) {
			this.writes.push(`delete ${r.type} ${r.name}`);
			const i = this.zone.findIndex(
				(z) => z.name === r.name && z.type === r.type,
			);
			if (i >= 0) this.zone.splice(i, 1);
		}
		return records.map((record) => ({
			record,
			deleted: true,
			notFound: false,
		}));
	}
}

const dns = (records?: unknown): WorkspaceDnsConfig =>
	({
		'example.com': {
			provider: 'godaddy',
			...(records ? { records } : {}),
		},
	}) as WorkspaceDnsConfig;

describe("the server's address, from the stage's secrets", () => {
	it('reads GKM_SERVER_IPV4 and GKM_SERVER_IPV6', () => {
		expect(
			serverAddress('production', {
				GKM_SERVER_IPV4: IPV4,
				GKM_SERVER_IPV6: IPV6,
			}),
		).toEqual({ ipv4: IPV4, ipv6: IPV6 });
		expect(serverAddress('production', {})).toBeUndefined();
	});

	it('refuses a value that is not an address, naming the key', () => {
		for (const [key, value] of [
			['GKM_SERVER_IPV4', '203.0.113'],
			['GKM_SERVER_IPV4', 'server.example.com'],
			['GKM_SERVER_IPV6', '2001:db8::zz'],
		] as const) {
			const failure = (() => {
				try {
					serverAddress('production', { GKM_SERVER_IPV4: IPV4, [key]: value });
				} catch (error) {
					return error;
				}
			})();
			expect(failure).toBeInstanceOf(ServerAddressInvalid);
			expect((failure as ServerAddressInvalid).key).toBe(key);
			expect((failure as Error).message).toContain(
				`gkm secrets:set ${key} '<ip>' --stage production`,
			);
		}
	});

	it('is required of a stage that serves a real domain', () => {
		expect(() =>
			requiredServerAddress('production', 'shop.example.com', {}),
		).toThrow(ServerAddressMissing);
		expect(() =>
			requiredServerAddress('production', 'shop.example.com', {}),
		).toThrow("gkm secrets:set GKM_SERVER_IPV4 '<ip>' --stage production");
	});

	it('is not required of a stage with no domain, or a .localhost one', () => {
		expect(requiredServerAddress('production', undefined, {})).toBeUndefined();
		expect(
			requiredServerAddress('staging', 'staging.shop.localhost', {}),
		).toBeUndefined();
	});

	it('is never handed to an app', () => {
		const secrets = {
			...initStageSecrets('production'),
			custom: {
				GKM_SERVER_IPV4: IPV4,
				GKM_SERVER_IPV6: IPV6,
				STRIPE_KEY: 'sk',
			},
		};

		// What a bundle embeds and `gkm exec` hands a process.
		expect(toEmbeddableSecrets(secrets)).toEqual({ STRIPE_KEY: 'sk' });
		// What Dokploy resolves an app's variables from.
		expect(
			resolveEnvVar('GKM_SERVER_IPV4', {
				userSecrets: secrets,
			} as never),
		).toBeUndefined();
		expect(resolveEnvVar('STRIPE_KEY', { userSecrets: secrets } as never)).toBe(
			'sk',
		);
	});
});

describe('the plan', () => {
	it('gives every host an A record by default, the apex included', () => {
		const plan = planStackDns({
			stage: 'production',
			hosts: HOSTS,
			server: { ipv4: IPV4 },
			dns: dns(),
		});

		expect(plan.uncovered).toEqual([]);
		expect(
			plan.domains[0]!.records.map(
				(r) => `${r.name} ${r.type} ${r.value} ${r.ttl}`,
			),
		).toEqual([
			`api.shop A ${IPV4} 600`,
			`auth.shop A ${IPV4} 600`,
			`shop A ${IPV4} 600`,
		]);
	});

	it('adds an AAAA record for each host when the server has IPv6', () => {
		const plan = planStackDns({
			stage: 'production',
			hosts: ['api.shop.example.com'],
			server: { ipv4: IPV4, ipv6: IPV6 },
			dns: dns(),
		});

		expect(plan.domains[0]!.records.map((r) => `${r.type} ${r.value}`)).toEqual(
			[`A ${IPV4}`, `AAAA ${IPV6}`],
		);
	});

	it('points every host but the apex at the CNAME target, which gets the A record', () => {
		const plan = planStackDns({
			stage: 'production',
			hosts: ['example.com', 'api.example.com', 'auth.example.com'],
			server: { ipv4: IPV4, ipv6: IPV6 },
			dns: dns({ mode: 'cname', target: 'server.example.com' }),
		});

		expect(
			plan.domains[0]!.records.map((r) => `${r.name} ${r.type} ${r.value}`),
		).toEqual([
			`@ A ${IPV4}`,
			`@ AAAA ${IPV6}`,
			'api CNAME server.example.com',
			'auth CNAME server.example.com',
			`server A ${IPV4}`,
			`server AAAA ${IPV6}`,
		]);
	});

	it('takes the CNAME target for the stage from a per-stage map', () => {
		const plan = planStackDns({
			stage: 'staging',
			hosts: ['api.staging.example.com'],
			server: { ipv4: IPV4 },
			dns: dns({
				mode: 'cname',
				target: {
					production: 'prod.example.com',
					staging: 'stage-box.example.com',
				},
			}),
		});

		expect(
			plan.domains[0]!.records.map((r) => `${r.name} ${r.type} ${r.value}`),
		).toEqual([
			'api.staging CNAME stage-box.example.com',
			`stage-box A ${IPV4}`,
		]);
	});

	it('names the hosts under no dns domain', () => {
		const plan = planStackDns({
			stage: 'production',
			hosts: ['api.example.com', 'files.other.org'],
			server: { ipv4: IPV4 },
			dns: dns(),
		});

		expect(plan.uncovered).toEqual(['files.other.org']);
	});
});

describe('applying it', () => {
	const plan = () =>
		planStackDns({
			stage: 'production',
			hosts: HOSTS,
			server: { ipv4: IPV4 },
			dns: dns(),
		});

	it('prints every record and what changes on a dry run, and writes nothing', async () => {
		const provider = new RecordingDns([
			{ name: 'shop', type: 'A', ttl: 600, values: ['198.51.100.7'] },
			{ name: 'api.shop', type: 'A', ttl: 600, values: [IPV4] },
		]);
		const lines: string[] = [];

		const changes = await applyStackDns(plan(), {
			dryRun: true,
			log: (line) => lines.push(line),
			providerFor: async () => provider,
		});

		expect(provider.writes).toEqual([]);
		expect(changes.map((c) => `${c.action} ${c.name}`)).toEqual([
			'unchanged api.shop',
			'create auth.shop',
			'update shop',
		]);
		const out = lines.join('\n');
		expect(out).toContain('dry run');
		expect(out).toMatch(
			/api\.shop\.example\.com\s+A\s+203\.0\.113\.10 {2}\(TTL 600\) — up to date/,
		);
		expect(out).toMatch(
			/auth\.shop\.example\.com\s+A\s+203\.0\.113\.10 {2}\(TTL 600\) — would create/,
		);
		expect(out).toContain('198.51.100.7 → 203.0.113.10');
	});

	it('writes nothing where every value is right', async () => {
		const provider = new RecordingDns(
			['shop', 'api.shop', 'auth.shop'].map((name) => ({
				name,
				type: 'A' as const,
				ttl: 600,
				values: [IPV4],
			})),
		);

		const changes = await applyStackDns(plan(), {
			log: () => {},
			providerFor: async () => provider,
		});

		expect(changes.every((c) => c.action === 'unchanged')).toBe(true);
		expect(provider.writes).toEqual([]);
	});

	it('updates a record with another value, and creates the missing', async () => {
		const provider = new RecordingDns([
			{ name: 'shop', type: 'A', ttl: 600, values: ['198.51.100.7'] },
		]);

		await applyStackDns(plan(), {
			log: () => {},
			providerFor: async () => provider,
		});

		expect(provider.writes.sort()).toEqual([
			`put A api.shop ${IPV4} 600`,
			`put A auth.shop ${IPV4} 600`,
			`put A shop ${IPV4} 600`,
		]);
		// And a second run changes nothing.
		provider.writes.length = 0;
		await applyStackDns(plan(), {
			log: () => {},
			providerFor: async () => provider,
		});
		expect(provider.writes).toEqual([]);
	});

	it('removes the A record of a host moving to a CNAME, and nothing else', async () => {
		const provider = new RecordingDns([
			{ name: 'api', type: 'A', ttl: 600, values: [IPV4] },
			{ name: 'mail', type: 'A', ttl: 600, values: ['198.51.100.9'] },
		]);

		await applyStackDns(
			planStackDns({
				stage: 'production',
				hosts: ['api.example.com'],
				server: { ipv4: IPV4 },
				dns: dns({ mode: 'cname', target: 'server.example.com' }),
			}),
			{ log: () => {}, providerFor: async () => provider },
		);

		expect(provider.writes).toEqual([
			'delete A api',
			'put CNAME api server.example.com 600',
			`put A server ${IPV4} 600`,
		]);
	});

	it('prints the records for a manual domain, and does nothing else', async () => {
		const lines: string[] = [];
		const changes = await applyStackDns(
			planStackDns({
				stage: 'production',
				hosts: HOSTS,
				server: { ipv4: IPV4 },
				dns: { 'example.com': { provider: 'manual' } },
			}),
			{
				log: (line) => lines.push(line),
				providerFor: async () => {
					throw new Error('no provider is asked for a manual domain');
				},
			},
		);

		expect(changes.every((c) => c.action === 'manual')).toBe(true);
		expect(lines.join('\n')).toContain('create these records at its DNS host');
		expect(lines.join('\n')).toMatch(
			/auth\.shop\.example\.com\s+A\s+203\.0\.113\.10/,
		);
	});
});

describe('applying it through GoDaddy with a token that may only update', () => {
	const writes: string[] = [];
	const server = setupServer(
		http.get(
			'https://api.godaddy.com/v1/domains/:domain/records/:type/:name',
			() =>
				HttpResponse.json(
					{
						code: 'ACCESS_DENIED',
						message: 'Authenticated user is not allowed access',
					},
					{ status: 403 },
				),
		),
		http.put(
			'https://api.godaddy.com/v1/domains/:domain/records/:type/:name',
			async ({ params, request }) => {
				writes.push(
					`${params.type} ${params.name} ${JSON.stringify(await request.json())}`,
				);
				return new HttpResponse(null, { status: 204 });
			},
		),
	);
	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());
	beforeEach(() => {
		writes.length = 0;
	});

	const run = (dryRun: boolean) => {
		const lines: string[] = [];
		const provider = new GoDaddyProvider({
			credential: { token: 'pat' },
			log: (line) => lines.push(line),
		});
		return applyStackDns(
			planStackDns({
				stage: 'production',
				hosts: ['shop.example.com', 'api.shop.example.com'],
				server: { ipv4: IPV4 },
				dns: dns(),
			}),
			{
				dryRun,
				log: (line) => lines.push(line),
				providerFor: async () => provider,
			},
		).then((changes) => ({ changes, lines }));
	};

	it('says it cannot diff, and lists what it would write on a dry run', async () => {
		const { changes, lines } = await run(true);

		expect(writes).toEqual([]);
		expect(changes.map((c) => c.action)).toEqual(['write', 'write']);
		const out = lines.join('\n');
		expect(out).toContain('cannot read');
		expect(out).toContain('current value unknown (key cannot read DNS)');
	});

	it('writes every record with a PUT each', async () => {
		await run(false);

		expect(writes).toEqual([
			`A api.shop [{"data":"${IPV4}","ttl":600}]`,
			`A shop [{"data":"${IPV4}","ttl":600}]`,
		]);
	});
});

describe('the check', () => {
	const check = (
		answers: Record<string, string[] | Error>,
		server = { ipv4: IPV4 },
	) =>
		checkStackDns({
			stage: 'production',
			hosts: Object.keys(answers),
			server,
			dns: dns(),
			lookup: async (host) => {
				const answer = answers[host]!;
				if (answer instanceof Error) throw answer;
				return answer;
			},
		});

	it('passes hosts that resolve to the server', async () => {
		await expect(
			check({
				'shop.example.com': [IPV4],
				'api.shop.example.com': [IPV4],
			}),
		).resolves.toEqual(['shop.example.com', 'api.shop.example.com']);
	});

	it('fails naming each host that does not, what it resolves to and the fix', async () => {
		const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
			code: 'ENOTFOUND',
		});
		const failure = await check({
			'shop.example.com': [IPV4],
			'api.shop.example.com': ['198.51.100.7'],
			'auth.shop.example.com': notFound,
		}).catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(HostNotPointingAtServer);
		const error = failure as HostNotPointingAtServer;
		expect(error.hosts.map((h) => h.host)).toEqual([
			'api.shop.example.com',
			'auth.shop.example.com',
		]);
		expect(error.message).toContain(
			`api.shop.example.com → 198.51.100.7, expected ${IPV4}`,
		);
		expect(error.message).toContain(
			'auth.shop.example.com → nothing (ENOTFOUND)',
		);
		expect(error.message).toContain('gkm setup --stage production');
		expect(error.message).toContain('--skip-dns-check');
	});

	it('fails a host with an address that is not the server’s, an old AAAA', async () => {
		await expect(
			check({ 'api.example.com': [IPV4, '2001:db8::99'] }),
		).rejects.toBeInstanceOf(HostNotPointingAtServer);
		await expect(
			check({ 'api.example.com': [IPV4, '2001:db8::10'] }, {
				ipv4: IPV4,
				ipv6: '2001:db8::10',
			} as never),
		).resolves.toEqual(['api.example.com']);
	});

	it('lists the records to create for hosts under no dns domain', async () => {
		const failure = (await checkStackDns({
			stage: 'production',
			hosts: ['files.other.org'],
			server: { ipv4: IPV4 },
			dns: dns(),
			lookup: async () => [],
		}).catch((e: unknown) => e)) as Error;

		expect(failure.message).toContain('create these records at the DNS host');
		expect(failure.message).toMatch(/files\.other\.org\s+A\s+203\.0\.113\.10/);
	});
});
