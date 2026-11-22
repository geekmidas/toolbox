import { randomInt } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
	DeleteAccessKeyCommand,
	DeleteUserCommand,
	DeleteUserPolicyCommand,
	IAMClient,
	ListAccessKeysCommand,
	ListUserPoliciesCommand,
} from '@aws-sdk/client-iam';
import {
	CreateHostedZoneCommand,
	DeleteHostedZoneCommand,
	Route53Client,
} from '@aws-sdk/client-route-53';
import type {
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
} from '@geekmidas/edge/dns';
import { edgeDnsSecretPath } from '@geekmidas/edge/proxy/traefik';
import { HttpResponse, http, passthrough } from 'msw';
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
import { LOCALSTACK_URL } from '../../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import {
	resolvesHere,
	SERVER_IPV4,
	serveFrom,
	stageCustom,
	writeComposeApp,
} from '../../../compose/__tests__/__helpers__/composeApp';
import {
	answering,
	fakeDocker,
	fakeServer,
} from '../../../compose/__tests__/__helpers__/fakeDocker';
import { originCa } from '../../../compose/__tests__/__helpers__/originCa';
import { AcmeDnsSecretsMissing, edgeAcmeUser } from '../../../compose/acmeDns';
import { DnsCredentialMissing } from '../../../compose/dns';
import { composeCommand } from '../../../compose/index';
import {
	ORIGIN_CERT_KEY,
	ORIGIN_KEY_KEY,
	ORIGIN_VALIDITY_DAYS,
} from '../../../compose/originCertificate';
import { storedCredentials } from '../../../deploy/credentials';
import { deploy } from '../../../deploy/deploy';
import {
	dnsResourceKey,
	dnsResources,
	recordDnsResource,
} from '../../../deploy/dnsResources';
import type { DeployEvent } from '../../../deploy/events';
import { DeployJournal } from '../../../deploy/journal';
import { createStateStore } from '../../../deploy/StateStore';
import { createComposeState } from '../../../deploy/state';
import type { SqlClient } from '../../../reconcile/provision';
import { ComposeAppsUnhealthy } from '../health';
import { type ComposeDeps, composeTarget } from '../index';
import { recordedForStack } from '../phases';

/**
 * The deploy writes its stage's DNS records: `gkm deploy` (and `gkm compose`,
 * the same run) plans each public host's record, writes the missing or
 * out-of-date ones through the domain's provider — GoDaddy's records API,
 * MSW in its place — and confirms them by reading them back, not by a public
 * lookup a brand-new name could be cached as missing in. Docker, Postgres and
 * the probe are recorders; the workspace, its secrets and its state are real.
 */

const RUN_TIMEOUT = 60_000;
const TOKEN = 'gd-pat-deploy';
const STAGING_IPV4 = '198.51.100.20';

/** Each zone: `<domain> <type> <name>` → its records. */
let zone: Map<string, { data: string; ttl: number }[]>;
let requests: string[];

const server = setupServer(
	http.get(
		'https://api.godaddy.com/v1/domains/:domain/records/:type/:name',
		({ params, request }) => {
			expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
			const { domain, type, name } = params as Record<string, string>;
			requests.push(`GET ${domain} ${type} ${name}`);
			return HttpResponse.json(
				(zone.get(`${domain} ${type} ${name}`) ?? []).map((r) => ({
					type,
					name,
					...r,
				})),
			);
		},
	),
	http.put(
		'https://api.godaddy.com/v1/domains/:domain/records/:type/:name',
		async ({ params, request }) => {
			expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
			const { domain, type, name } = params as Record<string, string>;
			requests.push(`PUT ${domain} ${type} ${name}`);
			zone.set(
				`${domain} ${type} ${name}`,
				(await request.json()) as { data: string; ttl: number }[],
			);
			return new HttpResponse(null, { status: 204 });
		},
	),
	http.delete(
		'https://api.godaddy.com/v1/domains/:domain/records/:type/:name',
		({ params, request }) => {
			expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
			const { domain, type, name } = params as Record<string, string>;
			requests.push(`DELETE ${domain} ${type} ${name}`);
			zone.delete(`${domain} ${type} ${name}`);
			return new HttpResponse(null, { status: 204 });
		},
	),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

let dir: string;

beforeEach(async () => {
	zone = new Map();
	requests = [];
	dir = realpathSync(await createTempDir('gkm-deploy-dns-'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

/**
 * A compose workspace whose domains' DNS is GoDaddy's. It takes no backups:
 * what they create in AWS is the backups suite's, not this one's.
 */
function workspace(options: Parameters<typeof writeComposeApp>[1] = {}) {
	writeComposeApp(dir, {
		registry: 'registry.example.com/acme',
		target: 'compose',
		dns: { 'example.com': { provider: 'godaddy' } },
		deployBackups: Object.fromEntries(
			(options.deployed ?? ['production']).map((stage) => [stage, false]),
		),
		...options,
	});
}

/** What the zone holds for the stage's three hosts, pointing at `ip`. */
function pointed(names: string[], ip = SERVER_IPV4) {
	for (const name of names) {
		zone.set(`example.com A ${name}`, [{ data: ip, ttl: 600 }]);
	}
}

const PUTS = () => requests.filter((r) => r.startsWith('PUT'));

/** Every file under `root`, but `node_modules`. */
function readdirRecursive(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(entry.parentPath, entry.name);
		if (entry.name === 'node_modules') return [];
		return entry.isDirectory() ? readdirRecursive(path) : [path];
	});
}

/** A run of the stage through `deploy()`, with each host resolved by `lookup`. */
async function run(
	stage: string,
	options: {
		token?: string | null;
		dryRun?: boolean;
		skipDns?: boolean;
		lookup?: (host: string) => Promise<string[]>;
		/** Every app answers with this status — 200 by default. */
		status?: number;
		/** Deps beyond the recorders — a DNS provider, the edge key's clients. */
		deps?: Partial<ComposeDeps>;
		/** The runner's environment beyond the GoDaddy token. */
		env?: Record<string, string>;
	} = {},
) {
	const fake = fakeDocker();
	const looked: string[] = [];
	const deps: Partial<ComposeDeps> = {
		revision: async () => 'abc1234',
		sql: () => ({ query: async () => [] }) satisfies SqlClient,
		logins: async ({ login }) => ({
			service: 'postgres',
			status: 'current',
			login,
		}),
		migrate: async () => [],
		seed: async () => [],
		healthIntervalMs: 0,
		...(options.status ? { healthAttempts: 1 } : {}),
		lookup: async (host) => {
			looked.push(host);
			if (options.lookup) return options.lookup(host);
			throw Object.assign(new Error(`${host} looked up`), {
				code: 'ENOTFOUND',
			});
		},
		docker: fake.docker,
		server: fakeServer([]),
		probe:
			options.status === undefined
				? answering(fake.calls)
				: async () => options.status!,
		...options.deps,
	};
	const token = options.token === undefined ? TOKEN : options.token;
	const deployed = deploy({
		cwd: dir,
		stage,
		target: 'compose',
		credentials: storedCredentials({
			env: {
				...(token ? { GODADDY_API_TOKEN: token } : {}),
				...options.env,
			},
		}),
		...(options.dryRun ? { dryRun: true } : {}),
		...(options.skipDns ? { skipDns: true } : {}),
		targets: { compose: composeTarget(deps) },
	});
	const seen: DeployEvent[] = [];
	for await (const event of deployed) seen.push(event);
	const error = await deployed.result.then(
		() => undefined,
		(e: unknown) => e,
	);
	const logs = seen
		.filter((e) => e.type === 'log')
		.map((e) => (e as { message: string }).message);
	return { seen, error, ops: fake.ops(), calls: fake.calls, looked, logs };
}

const released = (seen: DeployEvent[]) =>
	seen.some((e) => e.type === 'phase.finished' && e.phase === 'release');

describe('the deploy writes its DNS records', { timeout: RUN_TIMEOUT }, () => {
	it("creates a new app's record, and confirms it by reading it back", async () => {
		workspace();
		await serveFrom(dir);
		// The apex and the auth server were deployed before; the API is new.
		pointed(['shop', 'auth.shop']);

		const { error, seen, looked, logs } = await run('production');

		expect(error).toBeUndefined();
		expect(released(seen)).toBe(true);
		expect(PUTS()).toEqual(['PUT example.com A api.shop']);
		expect(zone.get('example.com A api.shop')).toEqual([
			{ data: SERVER_IPV4, ttl: 600 },
		]);
		// Read back from GoDaddy after the write — never looked up publicly.
		const put = requests.indexOf('PUT example.com A api.shop');
		expect(requests.slice(put + 1)).toContain('GET example.com A api.shop');
		expect(looked).toEqual([]);
		expect(logs).toContain('🌐 3 hosts confirmed by the DNS provider');
	});

	it('writes nothing where every record already points at the server', async () => {
		workspace();
		await serveFrom(dir);
		pointed(['shop', 'auth.shop', 'api.shop']);

		const { error, looked } = await run('production');

		expect(error).toBeUndefined();
		expect(PUTS()).toEqual([]);
		expect(requests).toEqual([
			'GET example.com A api.shop',
			'GET example.com AAAA api.shop',
			'GET example.com CNAME api.shop',
			'GET example.com A auth.shop',
			'GET example.com AAAA auth.shop',
			'GET example.com CNAME auth.shop',
			'GET example.com A shop',
			'GET example.com AAAA shop',
			'GET example.com CNAME shop',
		]);
		expect(looked).toEqual([]);
	});

	it("records each record in the stage's state", async () => {
		workspace();
		await serveFrom(dir);

		const { error } = await run('production');
		expect(error).toBeUndefined();

		const store = await createStateStore({
			config: undefined,
			workspaceRoot: dir,
			workspaceName: 'compose-app',
		});
		const stored = await store.read('production');
		expect(
			stored?.resources[dnsResourceKey('api.shop.example.com', 'A')],
		).toMatchObject({
			type: 'dns-record',
			id: 'api.shop.example.com A',
			status: 'ready',
			data: {
				domain: 'example.com',
				name: 'api.shop',
				value: SERVER_IPV4,
				ttl: 600,
				provider: 'godaddy',
			},
		});
	});

	it("writes a second stage's own hosts at its own server, and nothing of the first's", async () => {
		workspace({
			deployed: ['production', 'staging'],
			domains: {
				production: 'shop.example.com',
				staging: 'staging.example.com',
			},
		});
		await serveFrom(dir, 'production');
		await serveFrom(dir, 'staging', STAGING_IPV4);
		pointed(['shop', 'auth.shop', 'api.shop']);
		const production = new Map(zone);

		const { error } = await run('staging');

		expect(error).toBeUndefined();
		expect(PUTS().sort()).toEqual([
			'PUT example.com A api.staging',
			'PUT example.com A auth.staging',
			'PUT example.com A staging',
		]);
		expect(zone.get('example.com A api.staging')).toEqual([
			{ data: STAGING_IPV4, ttl: 600 },
		]);
		// Production's records were neither read nor written.
		expect(requests.some((r) => r.includes('shop'))).toBe(false);
		for (const [key, records] of production) {
			expect(zone.get(key)).toEqual(records);
		}
		// One record per host: no wildcard.
		expect([...zone.keys()].some((key) => key.includes('*'))).toBe(false);
	});

	it('fails before anything is built or started without the token, naming it and where it goes', async () => {
		workspace();
		await serveFrom(dir);

		const { error, ops, seen } = await run('production', { token: null });

		expect(error).toBeInstanceOf(DnsCredentialMissing);
		expect((error as DnsCredentialMissing).key).toBe('GODADDY_API_TOKEN');
		expect((error as Error).message).toContain(
			"secret on the 'production' GitHub environment",
		);
		expect(ops).toEqual([]);
		expect(requests).toEqual([]);
		expect(
			seen.some((e) => e.type === 'phase.started' && e.phase !== 'validate'),
		).toBe(false);
	});

	it('only resolves the hosts of a manual domain, writing nothing', async () => {
		workspace({ dns: { 'example.com': { provider: 'manual' } } });
		await serveFrom(dir);

		const { error, looked } = await run('production', {
			token: null,
			lookup: async () => [SERVER_IPV4],
		});

		expect(error).toBeUndefined();
		expect(requests).toEqual([]);
		expect(looked.sort()).toEqual([
			'api.shop.example.com',
			'auth.shop.example.com',
			'shop.example.com',
		]);
	});

	it('prints the plan on a dry run, and writes nothing', async () => {
		workspace();
		await serveFrom(dir);
		pointed(['shop', 'auth.shop']);

		const { error, logs, looked } = await run('production', { dryRun: true });

		expect(error).toBeUndefined();
		expect(PUTS()).toEqual([]);
		expect(looked).toEqual([]);
		// The server's address is in public DNS: it is printed, not masked.
		expect(logs).toContain(
			`🌐 DNS for 'production' → ${SERVER_IPV4} (dry run — nothing is written)`,
		);
		expect(logs).toContain(
			`   + api.shop.example.com             A     ${SERVER_IPV4}  (TTL 600) — would create`,
		);
	});

	it('neither writes nor checks with --skip-dns — and needs no token', async () => {
		workspace();
		await serveFrom(dir);

		const { error, looked, logs } = await run('production', {
			token: null,
			skipDns: true,
		});

		expect(error).toBeUndefined();
		expect(requests).toEqual([]);
		expect(looked).toEqual([]);
		expect(logs).toContain(
			'🌐 DNS skipped (--skip-dns): no record is written or checked',
		);
	});

	it('is the same step under gkm compose', async () => {
		workspace();
		await serveFrom(dir);
		vi.stubEnv('GODADDY_API_TOKEN', TOKEN);
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const fake = fakeDocker();

		await composeCommand(
			{ cwd: dir, stage: 'production', dryRun: true },
			{ docker: fake.docker, revision: async () => 'abc1234' },
		);

		// Read, never written, in a dry run; and through GoDaddy, not a lookup.
		expect(requests).toContain('GET example.com A api.shop');
		expect(PUTS()).toEqual([]);
		vi.unstubAllEnvs();
	});

	it('replaces a record pointing elsewhere, printing old → new', async () => {
		workspace();
		await serveFrom(dir);
		pointed(['shop', 'auth.shop']);
		pointed(['api.shop'], '198.51.100.7');

		const { error, logs } = await run('production');

		expect(error).toBeUndefined();
		expect(PUTS()).toEqual(['PUT example.com A api.shop']);
		expect(zone.get('example.com A api.shop')).toEqual([
			{ data: SERVER_IPV4, ttl: 600 },
		]);
		expect(logs.join('\n')).toContain(`198.51.100.7 → ${SERVER_IPV4}`);
	});
});

/** The stage's state store, as the deploy reads it. */
const stateStore = () =>
	createStateStore({
		config: undefined,
		workspaceRoot: dir,
		workspaceName: 'compose-app',
	});

/**
 * The stage as a deploy at `old.example.com` left it: its three hosts'
 * records in the zone, and in its state as gkm's.
 */
async function deployedAtOldDomain() {
	const journal = await DeployJournal.open(
		await stateStore(),
		'production',
		() => createComposeState('production'),
	);
	for (const name of ['old', 'api.old', 'auth.old']) {
		zone.set(`example.com A ${name}`, [{ data: SERVER_IPV4, ttl: 600 }]);
		await recordDnsResource(journal, {
			domain: 'example.com',
			name,
			type: 'A',
			value: SERVER_IPV4,
			ttl: 600,
			provider: 'godaddy',
		});
	}
}

const DELETES = () => requests.filter((r) => r.startsWith('DELETE')).sort();

describe(
	'the deploy after the stage moves to another domain',
	{ timeout: RUN_TIMEOUT },
	() => {
		it("writes the new domain's records, then deletes the old one's and forgets them", async () => {
			workspace();
			await serveFrom(dir);
			await deployedAtOldDomain();

			const { error, logs } = await run('production');

			expect(error).toBeUndefined();
			expect(PUTS().sort()).toEqual([
				'PUT example.com A api.shop',
				'PUT example.com A auth.shop',
				'PUT example.com A shop',
			]);
			expect(DELETES()).toEqual([
				'DELETE example.com A api.old',
				'DELETE example.com A auth.old',
				'DELETE example.com A old',
			]);
			// The old records go only once the new ones answer.
			const lastPut = Math.max(...PUTS().map((r) => requests.indexOf(r)));
			expect(requests.findIndex((r) => r.startsWith('DELETE'))).toBeGreaterThan(
				lastPut,
			);
			expect(zone.has('example.com A old')).toBe(false);
			expect(logs).toContain('🌐 3 records deleted');

			const stored = await (await stateStore()).read('production');
			expect(dnsResources(stored!.resources).map((r) => r.fqdn)).toEqual([
				'api.shop.example.com',
				'auth.shop.example.com',
				'shop.example.com',
			]);
		});

		it('leaves a record someone pointed elsewhere since, and forgets it', async () => {
			workspace();
			await serveFrom(dir);
			await deployedAtOldDomain();
			zone.set('example.com A api.old', [{ data: '198.51.100.7', ttl: 600 }]);

			const { error } = await run('production');

			expect(error).toBeUndefined();
			expect(DELETES()).toEqual([
				'DELETE example.com A auth.old',
				'DELETE example.com A old',
			]);
			expect(zone.get('example.com A api.old')).toEqual([
				{ data: '198.51.100.7', ttl: 600 },
			]);
			const stored = await (await stateStore()).read('production');
			expect(
				stored!.resources[dnsResourceKey('api.old.example.com', 'A')],
			).toBeUndefined();
		});

		it('keeps the old records while the stack does not answer on the new ones', async () => {
			workspace();
			await serveFrom(dir);
			await deployedAtOldDomain();

			const { error } = await run('production', { status: 502 });

			expect(error).toBeInstanceOf(ComposeAppsUnhealthy);
			expect(DELETES()).toEqual([]);
			expect(zone.get('example.com A old')).toEqual([
				{ data: SERVER_IPV4, ttl: 600 },
			]);
			const stored = await (await stateStore()).read('production');
			expect(
				stored!.resources[dnsResourceKey('old.example.com', 'A')],
			).toBeDefined();
		});

		it("deletes the old domain's records a provider asked for, once no provider asks for them", async () => {
			workspace();
			await serveFrom(dir);
			await deployedAtOldDomain();
			// A mail provider's DKIM record on the old domain, kept as gkm's;
			// this stage has no provider now, so none asks for it.
			const journal = await DeployJournal.open(
				await stateStore(),
				'production',
				() => createComposeState('production'),
			);
			zone.set('example.com CNAME tok._domainkey.old', [
				{ data: 'tok.dkim.amazonses.com', ttl: 600 },
			]);
			await recordDnsResource(journal, {
				domain: 'example.com',
				name: 'tok._domainkey.old',
				type: 'CNAME',
				value: 'tok.dkim.amazonses.com',
				ttl: 600,
				provider: 'godaddy',
				source: 'provider',
			});

			const { error } = await run('production');

			expect(error).toBeUndefined();
			expect(DELETES()).toContain(
				'DELETE example.com CNAME tok._domainkey.old',
			);
			const stored = await (await stateStore()).read('production');
			expect(
				stored!.resources[
					dnsResourceKey('tok._domainkey.old.example.com', 'CNAME')
				],
			).toBeUndefined();
		});

		it('prints what it would delete on a dry run, and deletes nothing', async () => {
			workspace();
			await serveFrom(dir);
			await deployedAtOldDomain();

			const { error, logs } = await run('production', { dryRun: true });

			expect(error).toBeUndefined();
			expect(DELETES()).toEqual([]);
			expect(logs).toContain("   No longer served by 'production':");
			expect(logs).toContain(
				`   - old.example.com                  A     ${SERVER_IPV4} — would delete`,
			);
		});
	},
);

/** A DNS provider holding one zone in memory, recording every write. */
function recordingDns() {
	const zone: DnsRecord[] = [];
	const writes: string[] = [];
	const provider: DnsProvider = {
		name: 'recording',
		async getRecords() {
			return zone;
		},
		async upsertRecords(_domain: string, records: UpsertDnsRecord[]) {
			for (const r of records) {
				writes.push(
					`put ${r.type} ${r.name} ${r.value} ${r.ttl}${r.proxied ? ' proxied' : ''}`,
				);
				zone.push({
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
		},
		async deleteRecords() {
			return [];
		},
	};
	return Object.assign(provider, { writes });
}

describe('the records the stack weighs against its plan', () => {
	const stack = { fqdn: 'api.example.com', type: 'A' };
	const dkim = {
		fqdn: 'tok._domainkey.example.com',
		type: 'CNAME',
		source: 'provider',
	};

	it('are every stack record, and each provider record no provider asked for', () => {
		expect(recordedForStack([stack, dkim], [])).toEqual([stack, dkim]);
	});

	it('leave out a provider record a provider asked for on this run', () => {
		expect(
			recordedForStack(
				[stack, dkim],
				[dnsResourceKey('tok._domainkey.example.com', 'CNAME')],
			),
		).toEqual([stack]);
	});

	it('leave out every provider record when the providers did not run, so none is pruned', () => {
		expect(recordedForStack([stack, dkim], undefined)).toEqual([stack]);
	});
});

describe('a wildcard site', { timeout: RUN_TIMEOUT }, () => {
	it('gets one *.<domain> record, beside the named hosts', async () => {
		workspace({ wildcard: true, protectedSubdomains: ['www'] });
		await serveFrom(dir);

		const { error, seen, logs } = await run('production');

		expect(error).toBeUndefined();
		expect(released(seen)).toBe(true);
		expect(PUTS().sort()).toEqual([
			'PUT example.com A *.shop',
			'PUT example.com A api.shop',
			'PUT example.com A auth.shop',
		]);
		expect(logs).toContain('🌐 3 hosts confirmed by the DNS provider');
	});

	describe('behind the shared edge, with GoDaddy holding the domain', () => {
		const KEYS = {
			GODADDY_API_KEY: 'the-godaddy-api-key',
			GODADDY_API_SECRET: 'the-godaddy-api-secret',
		};

		it("gives the edge the stage's GoDaddy keys before its routes ask for the certificate", async () => {
			workspace({ wildcard: true, compose: { proxy: 'traefik' } });
			await serveFrom(dir, 'production', SERVER_IPV4, undefined, KEYS);

			const { error, logs, calls } = await run('production', {
				lookup: resolvesHere,
			});

			expect(error).toBeUndefined();
			expect(PUTS()).toContain('PUT example.com A *.shop');
			expect(logs).toContain(
				'🔑 Wrote GODADDY_API_KEY, GODADDY_API_SECRET to gkm-edge, for _acme-challenge.shop.example.com through godaddy',
			);
			const execs = calls
				.filter((call) => call.op === 'exec')
				.map(
					(call) =>
						call.args as { command: string[]; input?: string; service: string },
				);
			const writes = execs.filter((e) => e.command[0] === 'sh');
			const key = writes.findIndex(
				(e) => e.command[4] === edgeDnsSecretPath('GODADDY_API_KEY'),
			);
			const secret = writes.findIndex(
				(e) => e.command[4] === edgeDnsSecretPath('GODADDY_API_SECRET'),
			);
			const routes = writes.findIndex((e) =>
				e.command[4]?.includes('/dynamic/'),
			);
			expect(key).toBeGreaterThanOrEqual(0);
			expect(secret).toBeGreaterThanOrEqual(0);
			// Into the edge, readable by it alone, before the stack's routes.
			expect(writes[key]!.command[5]).toBe('600');
			expect(key).toBeLessThan(routes);
			expect(secret).toBeLessThan(routes);
			// No key in any file the deploy wrote here — the edge's compose
			// file and its static configuration among them.
			const written = readdirRecursive(dir);
			const edgeCompose = written.find((f) => f.endsWith('/gkm-edge.yml'));
			expect(edgeCompose).toBeDefined();
			// The edge reads each key from the file it was written to.
			expect(readFileSync(edgeCompose!, 'utf-8')).toContain(
				`GODADDY_API_KEY_FILE: ${edgeDnsSecretPath('GODADDY_API_KEY')}`,
			);
			for (const file of written) {
				const content = readFileSync(file, 'utf-8');
				for (const value of Object.values(KEYS)) {
					expect(content, file).not.toContain(value);
				}
			}
		});

		it('refuses a stage without the keys before anything is started', async () => {
			workspace({ wildcard: true, compose: { proxy: 'traefik' } });
			await serveFrom(dir, 'production', SERVER_IPV4, undefined, {
				GODADDY_API_KEY: KEYS.GODADDY_API_KEY,
			});

			const { error, ops } = await run('production', { lookup: resolvesHere });

			expect(error).toBeInstanceOf(AcmeDnsSecretsMissing);
			expect((error as AcmeDnsSecretsMissing).keys).toEqual([
				'GODADDY_API_SECRET',
			]);
			expect(ops).toEqual([]);
			expect(PUTS()).toEqual([]);
		});
	});

	describe('behind Cloudflare’s CDN, on the shared edge', () => {
		const behindCloudflare = (cdn: Record<string, unknown> = {}) =>
			workspace({
				dns: { 'example.com': { provider: 'cloudflare' } },
				compose: { proxy: 'traefik' },
				deployCdn: { production: { provider: 'cloudflare', ...cdn } },
			});

		/** What the edge was written, by path, in order. */
		const edgeWrites = (calls: { op: string; args: unknown }[]) =>
			calls
				.filter((call) => call.op === 'exec')
				.map((call) => (call.args as { command: string[] }).command)
				.filter((command) => command[0] === 'sh')
				.map((command) => command[4]!);

		it('serves the site an origin certificate Cloudflare issued, kept in the stage', async () => {
			behindCloudflare();
			await serveFrom(dir);
			const records = recordingDns();
			const authority = originCa();
			const options = {
				lookup: resolvesHere,
				env: { CLOUDFLARE_API_TOKEN: 'the-deploy-token' },
				deps: {
					dnsProviderFor: async () => records,
					originIssuer: authority.issuer,
				},
			};

			const { error, calls } = await run('production', options);

			expect(error).toBeUndefined();
			// Issued once, for the site's host alone.
			expect(authority.asked).toEqual([
				{
					zone: 'example.com',
					hostnames: ['shop.example.com'],
					days: ORIGIN_VALIDITY_DAYS,
				},
			]);
			expect(records.writes).toContain('put A shop 203.0.113.10 300 proxied');
			expect(records.writes).toContain('put A api.shop 203.0.113.10 300');
			// Kept in the stage, under the server's reserved keys.
			const kept = await stageCustom(dir);
			expect(kept[ORIGIN_CERT_KEY]).toContain('BEGIN CERTIFICATE');
			expect(kept[ORIGIN_KEY_KEY]).toContain('PRIVATE KEY');
			// Into the edge, before the routes that serve it.
			const writes = edgeWrites(calls);
			const origin = writes.findIndex((path) => path.endsWith('-origin.crt'));
			expect(origin).toBeGreaterThanOrEqual(0);
			expect(origin).toBeLessThan(
				writes.findIndex((path) => path.includes('/dynamic/')),
			);
			// No key for the DNS challenge was asked for.
			expect(writes.some((path) => path.includes('acme-dns-'))).toBe(false);

			// The next deploy serves the one kept.
			const again = await run('production', options);
			expect(again.error).toBeUndefined();
			expect(authority.asked).toHaveLength(1);
		});

		it('refuses a stage without the edge’s Cloudflare key before anything is started, on the DNS challenge', async () => {
			behindCloudflare({ certificate: 'dns' });
			await serveFrom(dir, 'production');

			const { error, ops } = await run('production', {
				lookup: resolvesHere,
				env: { CLOUDFLARE_API_TOKEN: 'the-deploy-token' },
			});

			expect(error).toBeInstanceOf(AcmeDnsSecretsMissing);
			expect((error as AcmeDnsSecretsMissing).keys).toEqual([
				'CF_DNS_API_TOKEN',
			]);
			expect(ops).toEqual([]);
		});
	});

	describe('behind the shared edge, with Route 53 holding the domain', () => {
		const AWS = {
			region: 'us-east-1',
			endpoint: LOCALSTACK_URL,
			credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
		};
		const iam = new IAMClient(AWS);
		const route53 = new Route53Client(AWS);
		let zoneId: string;
		// The edge's IAM user is named after the server, and the emulator is
		// shared by every run on the machine: a server of this run's own, so
		// a concurrent run never adds a key to, or deletes, this one's user.
		const edgeServer = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;

		beforeAll(async () => {
			server.use(http.all(`${LOCALSTACK_URL}/*`, () => passthrough()));
			const created = await route53.send(
				new CreateHostedZoneCommand({
					Name: 'example.com',
					CallerReference: `deploy-dns-wildcard-${Date.now()}`,
				}),
			);
			zoneId = created.HostedZone!.Id!.replace('/hostedzone/', '');
		});

		afterAll(async () => {
			const UserName = edgeAcmeUser(edgeServer);
			const keys = await iam
				.send(new ListAccessKeysCommand({ UserName }))
				.catch(() => undefined);
			for (const key of keys?.AccessKeyMetadata ?? []) {
				await iam.send(
					new DeleteAccessKeyCommand({
						UserName,
						AccessKeyId: key.AccessKeyId,
					}),
				);
			}
			if (keys) {
				const { PolicyNames = [] } = await iam.send(
					new ListUserPoliciesCommand({ UserName }),
				);
				for (const PolicyName of PolicyNames) {
					await iam.send(new DeleteUserPolicyCommand({ UserName, PolicyName }));
				}
				await iam.send(new DeleteUserCommand({ UserName }));
			}
			await route53.send(new DeleteHostedZoneCommand({ Id: zoneId }));
		});

		it("gives the edge a key for the stage's challenge record before its routes ask for the certificate", async () => {
			workspace({
				wildcard: true,
				compose: { proxy: 'traefik' },
				dns: { 'example.com': { provider: 'route53', hostedZoneId: zoneId } },
			});
			await serveFrom(dir, 'production', edgeServer);
			const records = recordingDns();

			const { error, logs, calls } = await run('production', {
				lookup: async () => [edgeServer],
				deps: {
					dnsProviderFor: async () => records,
					acmeClients: async () => ({ iam, route53 }),
				},
			});

			expect(error).toBeUndefined();
			expect(records.writes).toContain(`put A *.shop ${edgeServer} 300`);
			expect(logs).toContain(
				`🔑 gkm-edge may write _acme-challenge.shop.example.com TXT records in ${zoneId}, and nothing else there, as IAM user ${edgeAcmeUser(edgeServer)}`,
			);
			const { AccessKeyMetadata = [] } = await iam.send(
				new ListAccessKeysCommand({ UserName: edgeAcmeUser(edgeServer) }),
			);
			expect(AccessKeyMetadata).toHaveLength(1);
			// The key is in the edge before the stack's routes are.
			const written = calls
				.filter((call) => call.op === 'exec')
				.map((call) => JSON.stringify(call.args));
			const key = written.findIndex((w) => w.includes('aws-credentials'));
			const routes = written.findIndex((w) => w.includes('dynamic/'));
			expect(key).toBeGreaterThanOrEqual(0);
			expect(key).toBeLessThan(routes);
		});
	});
});
