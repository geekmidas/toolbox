import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sitesFor, toCaddyfile } from '../caddyfile';
import type { Docker } from '../index';
import { COMPOSE_PATH, reconcile } from '../index';
import { planHash, saveState } from '../state';

/** A database and mail — one container that provisions, one that does not. */
const manifest = {
	Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
	Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
} as const satisfies ConstructManifest;

/** Records what was asked of Docker, and reports whatever it is told to. */
function fakeDocker(
	options: { running?: Record<string, number>; healthy?: boolean } = {},
) {
	const calls = { up: [] as string[][], healthy: 0 };

	const docker: Docker = {
		async publishedPort(_path, service, inside) {
			return options.running?.[`${service}:${inside}`];
		},
		async up(_path, services) {
			calls.up.push([...services]);
		},
		async healthy() {
			calls.healthy++;
			return options.healthy ?? false;
		},
		async copyOut() {},
		async reload() {},
	};

	return { docker, calls };
}

describe('reconcile', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-reconcile-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const run = (overrides: Partial<Parameters<typeof reconcile>[0]> = {}) => {
		const { docker } = fakeDocker();

		return reconcile({
			root,
			project: 'toolbox',
			manifest,
			stage: 'development',
			localStage: 'development',
			docker,
			probe: async () => true,
			sql: () => ({ query: async () => [] }),
			buckets: () => ({
				exists: async () => true,
				create: async () => {},
				policy: async () => undefined,
				setPolicy: async () => {},
			}),
			...overrides,
		});
	};

	it('derives its containers from what the app declared', async () => {
		// The list stops being a hand-maintained `services:` block: a database
		// implies Postgres, mail implies Mailpit.
		const { plan } = await run();

		expect(plan.containers.sort()).toEqual(['mailpit', 'postgres']);
	});

	it('writes the compose file it derived', async () => {
		await run();

		const written = await readFile(join(root, COMPOSE_PATH), 'utf-8');

		expect(written).toContain('postgres');
		expect(written).toContain('mailpit');
	});

	it('marks the generated file as generated', async () => {
		await run();

		expect(await readFile(join(root, COMPOSE_PATH), 'utf-8')).toMatch(
			/do not edit/i,
		);
	});

	it('starts every planned container', async () => {
		const { docker, calls } = fakeDocker();
		await run({ docker });

		expect(calls.up).toHaveLength(1);
		expect(calls.up[0].sort()).toEqual(['mailpit', 'postgres']);
	});

	it('drops the routes of a stage that was renamed', async () => {
		// `development` became `dev`: both files declare the same hosts, and Caddy
		// refuses the pair as ambiguous rather than picking one.
		const withApi = {
			...manifest,
			Api: {
				kind: 'rest-api',
				id: 'Api',
				path: '.',
				endpoints: [],
				provides: ['API_URL'],
			},
		} as const satisfies ConstructManifest;
		const sites = join(root, '.gkm/caddy-sites');
		await mkdir(sites, { recursive: true });
		await writeFile(join(sites, 'development.caddy'), 'stale');
		await writeFile(join(sites, 'test.caddy'), 'the test stage');

		await run({
			manifest: withApi,
			stage: 'dev',
			localStage: 'dev',
			addresses: { Api: 'http://localhost:3000' },
		});

		expect((await readdir(sites)).sort()).toEqual(['dev.caddy', 'test.caddy']);
	});

	it('reports what changed on a first run', async () => {
		expect((await run()).changed).toBe(true);
	});

	it('does nothing when the plan is unchanged and containers are healthy', async () => {
		// The fast path — reconciling on every start is only acceptable if the
		// converged case is free.
		await run();

		const { docker, calls } = fakeDocker({ healthy: true });
		const second = await reconcile({
			root,
			project: 'toolbox',
			manifest,
			stage: 'development',
			localStage: 'development',
			docker,
			probe: async () => true,
			sql: () => ({ query: async () => [] }),
			buckets: () => ({
				exists: async () => true,
				create: async () => {},
				policy: async () => undefined,
				setPolicy: async () => {},
			}),
		});

		expect(second.changed).toBe(false);
		expect(calls.up).toHaveLength(0);
	});

	it('provisions again when the role DDL changed, though no container did', async () => {
		// A toolbox upgrade that adds a grant changes no container and no route.
		// The state an older toolbox recorded hashed neither, so without the
		// statements in the hash the existing database never got the grant.
		// A database with a schema, so it has roles of its own to provision.
		const withRoles = {
			Orders: {
				kind: 'database',
				id: 'Orders',
				schema: 'app',
				provides: ['ORDERS_URL'],
			},
		} as const satisfies ConstructManifest;
		const first = await run({ manifest: withRoles });
		await saveState(root, {
			stage: 'development',
			hash: planHash(first.plan, first.compose, {
				caddyfile: toCaddyfile(sitesFor(first.plan, 'toolbox')),
			}),
		});

		const ran: string[] = [];
		const { docker } = fakeDocker({ healthy: true });
		const second = await run({
			manifest: withRoles,
			docker,
			sql: () => ({
				async query(_db: string | undefined, sql: string) {
					ran.push(sql);
					return [];
				},
			}),
		});

		expect(second.changed).toBe(true);
		expect(ran.some((sql) => sql.startsWith('GRANT CREATE ON DATABASE'))).toBe(
			true,
		);
	});

	it('acts again when the containers are not healthy', async () => {
		await run();

		const { docker, calls } = fakeDocker({ healthy: false });
		await run({ docker });

		expect(calls.up).toHaveLength(1);
	});

	it('acts again when the compose document changes without the plan', async () => {
		// The plan is unchanged, but an app service appearing is a different
		// file — which is why the hash covers the compose document, not just
		// the plan.
		await run();

		const { docker, calls } = fakeDocker({ healthy: true });
		const second = await run({
			docker,
			apps: () => ({ api: { image: 'api:latest', profiles: ['apps'] } }),
		});

		expect(second.changed).toBe(true);
		expect(calls.up).toHaveLength(1);
	});

	it('writes the compose file again when it is gone, however the state reads', async () => {
		// Gitignored and derived: a checkout without it must get one, even
		// with the recorded hash still matching.
		await run();
		const { rm } = await import('node:fs/promises');
		const { join } = await import('node:path');
		await rm(join(root, 'docker-compose.constructs.yml'));

		const { docker } = fakeDocker({ healthy: true });
		const again = await run({ docker });

		expect(again.changed).toBe(true);
	});

	it('keeps stages apart', async () => {
		// A file written for another stage is not this stage's state; treating it
		// as one is how `gkm test` would skip the work `gkm dev` did.
		await run();

		const { docker, calls } = fakeDocker({ healthy: true });
		const test = await run({ docker, stage: 'test' });

		expect(test.changed).toBe(true);
		expect(calls.up).toHaveLength(1);
	});

	it('reuses the port a running container already publishes', async () => {
		// A container someone started by hand is still the container serving the
		// app, so reconcile converges against what is running, not just its file.
		const { docker } = fakeDocker({ running: { 'postgres:5432': 55432 } });
		const { ports } = await run({ docker });

		expect(ports.postgres).toBe(55432);
	});

	it('keeps assignments from previous runs', async () => {
		const { ports } = await run({ saved: { postgres: 21111 } });

		expect(ports.postgres).toBe(21111);
	});

	it('publishes no container on a fixed default port', async () => {
		// One container publishing 5432 means the second project on the machine
		// cannot start.
		const { compose } = await run();

		expect(compose.services.postgres.ports).not.toContain('5432:5432');
	});

	it('reports where each container can be reached', async () => {
		const { addresses } = await run({ saved: { postgres: 21111 } });

		expect(addresses.postgres).toBe('localhost:21111');
	});

	it('resolves a URL for every construct', async () => {
		const { env } = await run();

		expect(Object.keys(env).sort()).toEqual([
			'MAIL_FROM',
			// Local only: where the mail it sent is read back.
			'MAIL_INBOX_URL',
			'MAIL_URL',
			// Not in `provides`: the owner URL is what a migrator connects with,
			// so no edge in any manifest can name it.
			'ORDERS_OWNER_URL',
			'ORDERS_URL',
		]);
	});

	it('creates the databases the plan names', async () => {
		const created: string[] = [];
		const { provisioned } = await run({
			sql: () => ({
				async query(_db: string | undefined, sql: string) {
					if (sql.startsWith('CREATE')) created.push(sql);
					return [];
				},
			}),
		});

		expect(created.some((sql) => sql.includes('CREATE DATABASE'))).toBe(true);
		expect(provisioned.map((p) => p.describe)).toContain('database orders');
	});

	it('creates nothing when asked only what would change', async () => {
		const created: string[] = [];
		const { provisioned } = await run({
			start: false,
			sql: () => ({
				async query(_db: string | undefined, sql: string) {
					if (sql.startsWith('CREATE')) created.push(sql);
					return [];
				},
			}),
		});

		expect(created).toEqual([]);
		expect(provisioned).toEqual([]);
	});

	it('adds the events container a declared topic needs', async () => {
		const withTopic = {
			...manifest,
			Users: {
				kind: 'topic',
				id: 'Users',
				provides: ['USERS_PUBLISHER_CONNECTION_STRING'],
			},
		} as const satisfies ConstructManifest;

		expect(
			(await run({ manifest: withTopic, events: 'rabbitmq' })).plan.containers,
		).toContain('rabbitmq');
	});

	it('starts no broker for a project that publishes nothing', async () => {
		// Selecting a backend is not the same as needing one — the declarations
		// decide whether a broker exists at all.
		expect((await run({ events: 'rabbitmq' })).plan.containers).not.toContain(
			'rabbitmq',
		);
	});

	it('resolves a queue onto pg-boss inside the declared database', async () => {
		const withQueue = {
			...manifest,
			Emails: {
				kind: 'queue',
				id: 'Emails',
				provides: ['EMAILS_PUBLISHER_CONNECTION_STRING'],
			},
		} as const satisfies ConstructManifest;

		const { env } = await run({ manifest: withQueue });

		expect(env.EMAILS_PUBLISHER_CONNECTION_STRING).toMatch(
			/^pgboss:\/\/.*\/orders\?schema=pgboss$/,
		);
		// The local pollers open one connection and subscribe every worker on it.
		expect(env.EVENT_SUBSCRIBER_CONNECTION_STRING).toBe(
			env.EMAILS_PUBLISHER_CONNECTION_STRING,
		);
	});

	it('starts nothing when asked only what would change', async () => {
		const { docker, calls } = fakeDocker();
		await run({ docker, start: false });

		expect(calls.up).toHaveLength(0);
	});

	it('plans nothing for a manifest that declares no resources', async () => {
		const { plan, changed } = await run({ manifest: {} });

		expect(plan.containers).toEqual([]);
		expect(changed).toBe(true);
	});

	it('starts no containers for an empty plan', async () => {
		const { docker, calls } = fakeDocker();
		await run({ docker, manifest: {} });

		expect(calls.up).toHaveLength(0);
	});
});
