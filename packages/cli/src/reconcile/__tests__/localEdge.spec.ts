import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { localAuthorityPaths } from '@geekmidas/edge/certificates/local';
import { EDGE_NETWORK, readEdgeClaims } from '@geekmidas/edge/proxy/traefik';
import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import { parse } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	WARM_TIMEOUT,
	warmComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import {
	edgeOnDisk,
	fakeDocker,
} from '../../compose/__tests__/__helpers__/fakeDocker';
import { composeStack } from '../../compose/stack';
import { deployIdentity } from '../../deploy/identity';
import type { NormalizedWorkspace } from '../../workspace/types';
import { type Docker, reconcile } from '../index';
import { planFor } from '../plan';
import { backendsOf, localEdgeFor, surfaceAddresses } from '../workspace';
import { TEST_CREDENTIALS } from './__helpers__/credentials';

/**
 * `gkm dev` follows `deploy.compose.proxy`: with Traefik for the local stage
 * it runs no Caddy of its own, and registers the stage's routes with this
 * machine's shared edge — the one `gkm compose --stage <local>` uses — from
 * the same route plan.
 */

/** Docker for this project's containers: up, healthy, nothing to reload. */
function projectDocker(): Docker & { reloads: string[] } {
	const reloads: string[] = [];
	return {
		reloads,
		async publishedPort() {
			return undefined;
		},
		async up() {},
		async healthy() {
			return true;
		},
		async reload(_path, service) {
			reloads.push(service);
		},
	};
}

/** No container is running here to sign in to. */
const unchecked: NonNullable<
	Parameters<typeof reconcile>[0]['logins']
> = async ({ credentials }) => ({ credentials, outcomes: [] });

/** Postgres answering that every database it is asked about exists. */
const postgres = () => ({
	query: async (
		_database: string | undefined,
		sql: string,
		params?: readonly unknown[],
	) =>
		sql.includes('pg_database') && Array.isArray(params?.[0])
			? (params[0] as string[]).map((datname) => ({ datname }))
			: [],
});

describe('gkm dev with proxy: traefik', { timeout: 60_000 }, () => {
	beforeAll(warmComposeApp, WARM_TIMEOUT);

	let dir: string;
	let home: string;
	let workspace: NormalizedWorkspace;
	let manifest: ConstructManifest;

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-dev-traefik-'));
		home = realpathSync(await createTempDir('gkm-dev-traefik-home-'));
		writeComposeApp(dir, { compose: { proxy: 'traefik' } });
		({ workspace, manifest } = await loadComposeApp(dir));
	});
	afterEach(async () => {
		await cleanupDir(dir);
		await cleanupDir(home);
	});

	/** The shared edge's volumes — here, a directory. */
	const volumes = () => join(home, 'edge');
	const registered = () =>
		join(volumes(), 'dynamic', 'compose-app-development.yml');

	/** One reconcile of the local stage, as `gkm dev` runs it. */
	const dev = async (
		overrides: Partial<Parameters<typeof reconcile>[0]> = {},
	) => {
		const edge = fakeDocker({ exec: edgeOnDisk(volumes()) });
		const docker = projectDocker();
		const result = await reconcile({
			credentials: TEST_CREDENTIALS,
			logins: unchecked,
			root: dir,
			authority: localAuthorityPaths(home),
			project: workspace.name,
			manifest,
			stage: 'development',
			localStage: workspace.stages.local,
			...backendsOf(workspace),
			edge: localEdgeFor(workspace, 'development', {}),
			addresses: surfaceAddresses(workspace, manifest),
			docker,
			edgeDocker: edge.docker,
			probe: async () => true,
			sql: postgres,
			buckets: () => ({
				exists: async () => true,
				create: async () => {},
				policy: async () => undefined,
				setPolicy: async () => {},
				notification: async () => ({}),
				setNotification: async () => {},
				lifecycle: async () => undefined,
				setLifecycle: async () => {},
			}),
			...overrides,
		});
		return { result, edge, docker };
	};

	it('starts no caddy container, and registers its routes with the edge', async () => {
		const { result, edge, docker } = await dev();

		expect(result.plan.edge).toEqual({
			proxy: 'traefik',
			ports: { https: 443, http: 80 },
			project: 'compose-app-development',
		});
		expect(result.plan.containers).not.toContain('caddy');
		expect(result.compose.services.caddy).toBeUndefined();
		expect(existsSync(join(dir, '.gkm', 'Caddyfile'))).toBe(false);
		expect(docker.reloads).toEqual([]);

		// The shared edge, up on its network, as `gkm compose` starts it.
		expect(edge.calls).toEqual(
			expect.arrayContaining([
				{ op: 'network', args: EDGE_NETWORK },
				{ op: 'up', args: ['traefik'], edge: true },
			]),
		);

		// The stage's routes, to the processes `gkm dev` runs on the host.
		const file = parse(readFileSync(registered(), 'utf-8'));
		const api = workspace.apps.api!.port;
		expect(
			file.http.services['compose-app-development-api'].loadBalancer.servers,
		).toEqual([{ url: `http://host.docker.internal:${api}` }]);
		expect(file.http.routers['compose-app-development-api'].rule).toBe(
			'Host(`api.compose-app.localhost`)',
		);
		// With the certificate gkm's local authority issued the stage.
		expect(file.tls.certificates).toEqual([
			{
				certFile: '/etc/gkm-edge/certs/compose-app-development.crt',
				keyFile: '/etc/gkm-edge/certs/compose-app-development.key',
			},
		]);
		expect(
			readFileSync(
				join(volumes(), 'certs', 'compose-app-development.crt'),
				'utf-8',
			),
		).toContain('BEGIN CERTIFICATE');

		// Reached on the edge's own port, which 443 leaves out of the address.
		expect(result.env.API_URL).toBe('https://api.compose-app.localhost');
		expect(result.env.WEB_URL).toBe('https://compose-app.localhost');
		expect(result.env.NODE_EXTRA_CA_CERTS).toBe(
			localAuthorityPaths(home).certFile,
		);
	});

	it('registers the routes gkm compose --stage development registers', async () => {
		await dev();
		const stack = composeStack({
			workspace,
			manifest,
			background: {},
			stage: 'development',
			identity: deployIdentity(workspace, 'development'),
			images: { mode: 'build', tag: 'abc' },
			secrets: null,
			localCredentials: TEST_CREDENTIALS,
			localAuthority: localAuthorityPaths(home),
			ports: {},
		});
		const devFile = readFileSync(registered(), 'utf-8');

		// The same routers, on the same hosts, under the same project — only
		// where each sends differs: a process on the host, or a container.
		const rules = (file: string) =>
			Object.fromEntries(
				Object.entries(
					parse(file).http.routers as Record<string, { rule: string }>,
				).map(([name, router]) => [name, router.rule]),
			);
		expect(stack.proxy).toBe('traefik');
		expect(Object.keys(rules(devFile))).toEqual(
			expect.arrayContaining([
				'compose-app-development-api',
				'compose-app-development-auth',
				'compose-app-development-web',
			]),
		);
		expect(rules(devFile)).toEqual(rules(stack.traefik!));
		expect(readEdgeClaims(devFile)).toEqual(readEdgeClaims(stack.traefik!));
	});

	it('updates the edge without a restart when its routes change', async () => {
		await dev();
		const before = readFileSync(registered(), 'utf-8');

		// A new app, as one added while `gkm dev` runs.
		const addresses = surfaceAddresses(workspace, manifest);
		const { edge } = await dev({
			addresses: { ...addresses, Auth: 'http://localhost:4999' },
		});
		const after = readFileSync(registered(), 'utf-8');

		expect(after).not.toBe(before);
		expect(
			parse(after).http.services['compose-app-development-auth'].loadBalancer
				.servers,
		).toEqual([{ url: 'http://host.docker.internal:4999' }]);
		// Nothing removed or restarted: the edge reads the file it watches.
		expect(edge.ops()).not.toContain('remove');
		expect(
			edge.calls.some((call) => JSON.stringify(call.args).includes('kill')),
		).toBe(false);
	});

	it('registers again when the edge lost its routes, though nothing else changed', async () => {
		await dev();
		rmSync(registered());

		const { result } = await dev();

		expect(result.changed).toBe(true);
		expect(existsSync(registered())).toBe(true);
	});

	it('is converged when the edge serves its routes', async () => {
		await dev();

		const { result, edge } = await dev();

		expect(result.changed).toBe(false);
		expect(edge.ops()).not.toContain('up');
	});
});

describe('the proxy gkm dev runs behind', () => {
	let dir: string;
	let workspace: NormalizedWorkspace;
	let manifest: ConstructManifest;

	beforeAll(async () => {
		await warmComposeApp();
		dir = realpathSync(await createTempDir('gkm-dev-proxy-'));
		writeComposeApp(dir);
		({ workspace, manifest } = await loadComposeApp(dir));
	}, WARM_TIMEOUT);
	afterAll(async () => {
		await cleanupDir(dir);
	});

	const withProxy = (proxy: unknown): NormalizedWorkspace => ({
		...workspace,
		deploy: {
			...workspace.deploy,
			compose: proxy === undefined ? {} : ({ proxy } as never),
		},
	});

	it.for([
		['no proxy', undefined, 'caddy'],
		['caddy', 'caddy', 'caddy'],
		[
			'a map keeping the local stage on caddy',
			{ production: 'traefik' },
			'caddy',
		],
		[
			'a map naming caddy locally',
			{ development: 'caddy', production: 'traefik' },
			'caddy',
		],
		['traefik', 'traefik', 'traefik'],
		['a map naming traefik locally', { development: 'traefik' }, 'traefik'],
	] as const)('follows deploy.compose.proxy: %s', ([, proxy, expected]) => {
		expect(localEdgeFor(withProxy(proxy), 'development', {}).proxy).toBe(
			expected,
		);
	});

	it('is one edge for every stage reconcile runs, test included', () => {
		// The local stage's proxy, whichever stage is reconciled: `gkm test`
		// registers beside `gkm dev`, under its own project.
		expect(
			localEdgeFor(withProxy({ development: 'traefik' }), 'test', {}),
		).toEqual({
			proxy: 'traefik',
			ports: { https: 443, http: 80 },
			project: 'compose-app-test',
		});
	});

	it('is on the ports gkm compose publishes the edge on', () => {
		expect(
			localEdgeFor(withProxy('traefik'), 'development', {
				GKM_COMPOSE_HTTPS_PORT: '8443',
				GKM_COMPOSE_HTTP_PORT: '8080',
			}),
		).toMatchObject({ ports: { https: 8443, http: 8080 } });
	});

	it('runs a Caddy of its own on caddy, and no edge at all with edge: false', () => {
		const plan = (edge: Parameters<typeof planFor>[3]['edge']) =>
			planFor(manifest, 'development', provisionOrder(manifest), {
				localStage: 'development',
				...backendsOf(workspace),
				...(edge === undefined ? {} : { edge }),
			});

		expect(
			plan(localEdgeFor(withProxy(undefined), 'development')).containers,
		).toContain('caddy');
		expect(plan(false).containers).not.toContain('caddy');
		expect(plan(false).edge).toBeUndefined();
	});
});
