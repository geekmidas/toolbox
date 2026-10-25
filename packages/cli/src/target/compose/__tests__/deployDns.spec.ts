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
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import {
	SERVER_IPV4,
	serveFrom,
	writeComposeApp,
} from '../../../compose/__tests__/__helpers__/composeApp';
import {
	answering,
	fakeDocker,
	fakeServer,
} from '../../../compose/__tests__/__helpers__/fakeDocker';
import { DnsCredentialMissing } from '../../../compose/dns';
import { composeCommand } from '../../../compose/index';
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
	};
	const token = options.token === undefined ? TOKEN : options.token;
	const deployed = deploy({
		cwd: dir,
		stage,
		target: 'compose',
		credentials: storedCredentials({
			env: token ? { GODADDY_API_TOKEN: token } : {},
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
	return { seen, error, ops: fake.ops(), looked, logs };
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
