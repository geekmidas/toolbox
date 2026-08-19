import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Docker } from '../index';
import { COMPOSE_PATH, reconcile } from '../index';

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
			docker,
			probe: async () => true,
			sql: () => ({ query: async () => [] }),
			buckets: () => ({ exists: async () => true, create: async () => {} }),
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
			docker,
			probe: async () => true,
			sql: () => ({ query: async () => [] }),
			buckets: () => ({ exists: async () => true, create: async () => {} }),
		});

		expect(second.changed).toBe(false);
		expect(calls.up).toHaveLength(0);
	});

	it('acts again when the containers are not healthy', async () => {
		await run();

		const { docker, calls } = fakeDocker({ healthy: false });
		await run({ docker });

		expect(calls.up).toHaveLength(1);
	});

	it('acts again when an image pin moves', async () => {
		// The plan is unchanged, but a changed image is exactly a container that
		// must be recreated — which is why the hash covers the compose document.
		await run();

		const { docker, calls } = fakeDocker({ healthy: true });
		const second = await run({
			docker,
			images: { postgres: 'postgis/postgis:18-3.5' },
		});

		expect(second.changed).toBe(true);
		expect(calls.up).toHaveLength(1);
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
			'MAIL_URL',
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

	it('adds the events container the backend needs', async () => {
		expect((await run({ events: 'sns' })).plan.containers).toContain(
			'localstack',
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
