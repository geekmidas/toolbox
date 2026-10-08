import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
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
import { parse } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import { safeValidateWorkspaceConfig } from '../../workspace/schema';
import type { NormalizedWorkspace } from '../../workspace/types';
import { edgeCaddyfile } from '../caddyfile';
import { portHolders, publishedPorts } from '../docker';
import {
	assertEdgePorts,
	ComposeProxyClash,
	edgeDir,
	ensureEdge,
	removeEdgeRoutes,
	routesFile,
	writeEdgeRoutes,
} from '../edge';
import { ComposeTlsFileMissing, composeCommand } from '../index';
import {
	ComposeStageUnknown,
	ComposeTlsOnLocalStage,
	checkComposeStages,
	proxyFor,
} from '../proxy';
import type { EdgeRoute } from '../routes';
import { type ComposeStack, composeStack, type StackInput } from '../stack';
import {
	EDGE_NETWORK,
	EDGE_PROJECT,
	edgeCompose,
	TRAEFIK_IMAGE,
	traefikDynamic,
	traefikStatic,
} from '../traefik';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

/** No Postgres is running here: its login is taken as the one it was given. */
const signedIn: NonNullable<Parameters<typeof composeCommand>[1]>['logins'] =
	async ({ login }) => ({ service: 'postgres', status: 'current', login });

import { fakeDocker } from './__helpers__/fakeDocker';

/** The routes of a stack with every kind of host: apps, a bucket, logs. */
const ROUTES: EdgeRoute[] = [
	{
		name: 'api',
		host: 'api.shop.example.com',
		upstreams: [{ service: 'api', port: 3000 }],
		streaming: true,
		health: '/health',
	},
	{
		name: 'web',
		host: 'shop.example.com',
		upstreams: [{ service: 'web', port: 3002 }],
		streaming: true,
		health: '/',
	},
	{
		name: 'files-uploads-server',
		host: 'uploads-server.shop.example.com',
		upstreams: [{ service: 'minio', port: 9000 }],
		streaming: false,
		prefix: '/uploads',
	},
	{
		name: 'openobserve',
		host: 'logs.shop.example.com',
		upstreams: [{ service: 'openobserve', port: 5080 }],
		streaming: true,
		allow: ['203.0.113.7', '10.0.0.0/8'],
	},
];

describe('the route model, rendered for Caddy', () => {
	it('renders every route as a site block', () => {
		expect(edgeCaddyfile(ROUTES, { tls: { kind: 'acme' } })).toMatchSnapshot();
	});

	it('streams apps, rewrites a bucket, and allows only the listed addresses', () => {
		const caddyfile = edgeCaddyfile(ROUTES, { tls: { kind: 'acme' } });

		expect(caddyfile.match(/flush_interval -1/g)).toHaveLength(3);
		expect(caddyfile).toContain('rewrite /uploads{uri}');
		expect(caddyfile).toContain('header_up Host {upstream_hostport}');
		expect(caddyfile).toContain('@denied not remote_ip 203.0.113.7 10.0.0.0/8');
		expect(caddyfile.match(/remote_ip/g)).toHaveLength(1);
	});

	it("serves a stage's own certificate in every block", () => {
		const caddyfile = edgeCaddyfile(ROUTES, {
			tls: {
				kind: 'files',
				certFile: '/etc/caddy/tls/cert.pem',
				keyFile: '/etc/caddy/tls/key.pem',
			},
		});

		expect(
			caddyfile.match(
				/tls \/etc\/caddy\/tls\/cert\.pem \/etc\/caddy\/tls\/key\.pem/g,
			),
		).toHaveLength(4);
	});

	it('balances over every upstream a route names', () => {
		const caddyfile = edgeCaddyfile(
			[
				{
					...ROUTES[0]!,
					upstreams: [
						{ service: 'api', port: 3000 },
						{ service: 'api-next', port: 3000 },
					],
				},
			],
			{ tls: { kind: 'acme' } },
		);
		expect(caddyfile).toContain('reverse_proxy api:3000 api-next:3000 {');
	});
});

describe('the route model, rendered for Traefik', () => {
	const dynamic = (
		tls: Parameters<typeof traefikDynamic>[1]['tls'] = {
			kind: 'acme',
		},
	) =>
		traefikDynamic(ROUTES, { project: 'shop-production', tls }) as {
			http: {
				routers: Record<string, Record<string, unknown>>;
				services: Record<string, { loadBalancer: Record<string, unknown> }>;
				middlewares: Record<string, Record<string, unknown>>;
			};
			tls?: { certificates: { certFile: string; keyFile: string }[] };
		};

	it('renders routers, services and middlewares', () => {
		expect(dynamic()).toMatchSnapshot();
	});

	it("prefixes every name with the stack's project, so stacks never collide", () => {
		const { http } = dynamic();
		for (const names of [
			Object.keys(http.routers),
			Object.keys(http.services),
			Object.keys(http.middlewares),
		]) {
			for (const name of names) expect(name).toMatch(/^shop-production-/);
		}
		// And reaches each upstream by its alias on the shared network.
		expect(http.services['shop-production-api']?.loadBalancer.servers).toEqual([
			{ url: 'http://shop-production-api:3000' },
		]);
	});

	it('routes each host on HTTPS, with a certificate from ACME', () => {
		const router = dynamic().http.routers['shop-production-api']!;

		expect(router.rule).toBe('Host(`api.shop.example.com`)');
		expect(router.entryPoints).toEqual(['websecure']);
		expect(router.tls).toEqual({ certResolver: 'letsencrypt' });
	});

	it('never buffers a streamed response, and checks each app on its health path', () => {
		const { services } = dynamic().http;

		expect(services['shop-production-api']?.loadBalancer).toMatchObject({
			responseForwarding: { flushInterval: '-1ms' },
			healthCheck: { path: '/health' },
		});
		expect(services['shop-production-web']?.loadBalancer).toMatchObject({
			healthCheck: { path: '/' },
		});
	});

	it('allows only the listed addresses to the logs, with ipAllowList', () => {
		const { routers, middlewares } = dynamic().http;

		expect(routers['shop-production-openobserve']?.middlewares).toEqual([
			'shop-production-openobserve-allow',
		]);
		expect(middlewares['shop-production-openobserve-allow']).toEqual({
			ipAllowList: { sourceRange: ['203.0.113.7', '10.0.0.0/8'] },
		});
		expect(routers['shop-production-api']?.middlewares).toBeUndefined();
	});

	it("sends a bucket's requests to MinIO under its prefix, with MinIO's own Host", () => {
		const { routers, services, middlewares } = dynamic().http;

		expect(
			routers['shop-production-files-uploads-server']?.middlewares,
		).toEqual(['shop-production-files-uploads-server-prefix']);
		expect(middlewares['shop-production-files-uploads-server-prefix']).toEqual({
			addPrefix: { prefix: '/uploads' },
		});
		const bucket = services['shop-production-files-uploads-server']!;
		expect(bucket.loadBalancer.passHostHeader).toBe(false);
		expect(bucket.loadBalancer.responseForwarding).toBeUndefined();
	});

	it("serves a stage's own certificate instead of ACME", () => {
		const own = dynamic({
			kind: 'files',
			certFile: '/etc/gkm-edge/certs/shop-production.crt',
			keyFile: '/etc/gkm-edge/certs/shop-production.key',
		});

		expect(own.http.routers['shop-production-api']?.tls).toEqual({});
		expect(own.tls?.certificates).toEqual([
			{
				certFile: '/etc/gkm-edge/certs/shop-production.crt',
				keyFile: '/etc/gkm-edge/certs/shop-production.key',
			},
		]);
	});

	it('balances over every upstream a route names', () => {
		const two = traefikDynamic(
			[
				{
					...ROUTES[0]!,
					upstreams: [
						{ service: 'api', port: 3000 },
						{ service: 'api-next', port: 3000 },
					],
				},
			],
			{ project: 'p', tls: { kind: 'acme' } },
		) as { http: { services: Record<string, { loadBalancer: unknown }> } };
		expect(two.http.services['p-api']?.loadBalancer).toMatchObject({
			servers: [
				{ url: 'http://p-api:3000' },
				{ url: 'http://p-api-next:3000' },
			],
		});
	});
});

describe('the edge', () => {
	it('redirects HTTP to HTTPS, answers ACME, and watches one directory', () => {
		const config = traefikStatic({ https: 443, http: 80 }) as {
			entryPoints: Record<string, Record<string, unknown>>;
			providers: unknown;
			certificatesResolvers: unknown;
			api?: unknown;
		};

		expect(config).toMatchSnapshot();
		expect(config.entryPoints.web?.http).toEqual({
			redirections: {
				entryPoint: { to: 'websecure', scheme: 'https', permanent: true },
			},
		});
		expect(config.providers).toEqual({
			file: { directory: '/etc/gkm-edge/dynamic', watch: true },
		});
		// No dashboard, no API.
		expect(config.api).toBeUndefined();
	});

	it('redirects to the published port when it is not 443', () => {
		const config = traefikStatic({ https: 8443, http: 8080 }) as {
			entryPoints: { web: { http: { redirections: { entryPoint: unknown } } } };
		};
		expect(config.entryPoints.web.http.redirections.entryPoint).toMatchObject({
			to: ':8443',
		});
	});

	it('runs the pinned image on the shared network, with its ACME state on a volume', () => {
		const compose = edgeCompose({
			dir: '/home/deploy/.gkm/edge',
			ports: { https: 443, http: 80 },
			staticConfig: 'x',
			logging: { driver: 'json-file', options: {} },
		}) as {
			name: string;
			services: { traefik: Record<string, unknown> };
			networks: unknown;
			volumes: unknown;
		};

		expect(compose.name).toBe(EDGE_PROJECT);
		expect(compose.services.traefik.image).toBe(TRAEFIK_IMAGE);
		expect(TRAEFIK_IMAGE).toMatch(/^traefik:v3\.\d+\.\d+$/);
		expect(compose.services.traefik.ports).toEqual(['443:443', '80:80']);
		expect(compose.services.traefik.volumes).toEqual([
			'/home/deploy/.gkm/edge/traefik.yml:/etc/traefik/traefik.yml:ro',
			'/home/deploy/.gkm/edge/dynamic:/etc/gkm-edge/dynamic:ro',
			'/home/deploy/.gkm/edge/certs:/etc/gkm-edge/certs:ro',
			'acme:/acme',
		]);
		expect(compose.networks).toEqual({
			edge: { name: EDGE_NETWORK, external: true },
		});
		expect(compose.volumes).toEqual({ acme: {} });
	});

	describe('on disk and in Docker', () => {
		let dir: string;
		beforeEach(async () => {
			dir = realpathSync(await createTempDir('gkm-edge-'));
		});
		afterEach(async () => {
			await cleanupDir(dir);
		});

		it('creates its network, writes its files, and starts it', async () => {
			const { docker, calls } = fakeDocker();
			const logging = { driver: 'json-file', options: {} };

			await ensureEdge(docker, {
				dir,
				ports: { https: 443, http: 80 },
				logging,
			});

			expect(calls).toEqual([
				{ op: 'network', args: EDGE_NETWORK },
				{ op: 'up', args: ['traefik'], edge: true },
			]);
			expect(
				parse(readFileSync(join(dir, 'docker-compose.yml'), 'utf-8')).name,
			).toBe(EDGE_PROJECT);
			expect(
				parse(readFileSync(join(dir, 'traefik.yml'), 'utf-8')).providers,
			).toEqual({ file: { directory: '/etc/gkm-edge/dynamic', watch: true } });
			expect(existsSync(join(dir, 'dynamic'))).toBe(true);
			expect(statSync(join(dir, 'certs')).mode & 0o777).toBe(0o700);

			// A second run with the same ports leaves the files as they were.
			const before = statSync(join(dir, 'docker-compose.yml')).mtimeMs;
			await ensureEdge(docker, {
				dir,
				ports: { https: 443, http: 80 },
				logging,
			});
			expect(statSync(join(dir, 'docker-compose.yml')).mtimeMs).toBe(before);

			// Moved ports change its configuration — and the label that
			// recreates it.
			const label = (file: string) =>
				parse(file).services.traefik.labels['dev.geekmidas.edge.config'];
			const first = label(
				readFileSync(join(dir, 'docker-compose.yml'), 'utf-8'),
			);
			await ensureEdge(docker, {
				dir,
				ports: { https: 8443, http: 8080 },
				logging,
			});
			expect(
				label(readFileSync(join(dir, 'docker-compose.yml'), 'utf-8')),
			).not.toBe(first);
		});

		it("writes a stack's file whole, with its certificate first, and removes both", async () => {
			const source = join(dir, 'source');
			mkdirSync(source);
			writeFileSync(join(source, 'cert.pem'), 'CERT');
			writeFileSync(join(source, 'key.pem'), 'KEY');

			const files = await writeEdgeRoutes(
				dir,
				'shop-production',
				'http: {}\n',
				{
					certFile: join(source, 'cert.pem'),
					keyFile: join(source, 'key.pem'),
				},
			);

			expect(files.at(-1)).toBe(routesFile(dir, 'shop-production'));
			expect(readFileSync(routesFile(dir, 'shop-production'), 'utf-8')).toBe(
				'http: {}\n',
			);
			expect(
				readFileSync(join(dir, 'certs', 'shop-production.crt'), 'utf-8'),
			).toBe('CERT');
			expect(
				statSync(join(dir, 'certs', 'shop-production.key')).mode & 0o777,
			).toBe(0o600);
			// Nothing half written is left for the edge to read.
			expect(readdirSync(join(dir, 'dynamic'))).toEqual([
				'shop-production.yml',
			]);

			expect(await removeEdgeRoutes(dir, 'shop-production')).toBe(true);
			expect(readdirSync(join(dir, 'dynamic'))).toEqual([]);
			expect(readdirSync(join(dir, 'certs'))).toEqual([]);
			expect(await removeEdgeRoutes(dir, 'shop-production')).toBe(false);
		});

		it('leaves every other stack registered', async () => {
			await writeEdgeRoutes(dir, 'a-production', 'http: {}\n');
			await writeEdgeRoutes(dir, 'b-staging', 'http: {}\n');

			await removeEdgeRoutes(dir, 'a-production');

			expect(readdirSync(join(dir, 'dynamic'))).toEqual(['b-staging.yml']);
		});

		it('lives in the gkm home', () => {
			expect(edgeDir({ GKM_HOME: dir })).toBe(join(dir, 'edge'));
		});
	});
});

describe('a clash over the edge ports', () => {
	const ports = { https: 443, http: 80 };

	it("reads the host ports out of docker's Ports column", () => {
		expect(
			publishedPorts(
				'0.0.0.0:443->443/tcp, [::]:443->443/tcp, 0.0.0.0:9000-9001->9000-9001/tcp, 3000/tcp',
			).sort((a, b) => a - b),
		).toEqual([443, 9000, 9001]);
		expect(
			portHolders(
				'shop-caddy-1\tshop-production\tcaddy\t0.0.0.0:443->443/tcp\nother-1\t\t\t3000/tcp\n',
				443,
			),
		).toEqual([
			{
				container: 'shop-caddy-1',
				project: 'shop-production',
				service: 'caddy',
			},
		]);
	});

	it("refuses traefik while the stack's own Caddy still holds 443", async () => {
		const { docker } = fakeDocker({
			holders: {
				443: [
					{
						container: 'shop-production-caddy-1',
						project: 'shop-production',
						service: 'caddy',
					},
				],
			},
		});

		const error = await assertEdgePorts(docker, {
			project: 'shop-production',
			proxy: 'traefik',
			ports,
		}).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeProxyClash);
		expect(error).toMatchObject({ port: 443, proxy: 'traefik' });
		expect((error as Error).message).toContain(
			'docker compose -p shop-production stop caddy',
		);
	});

	it('refuses caddy while the shared edge holds the ports', async () => {
		const { docker } = fakeDocker({
			holders: {
				80: [
					{
						container: 'gkm-edge-traefik-1',
						project: 'gkm-edge',
						service: 'traefik',
					},
				],
			},
		});

		const error = await assertEdgePorts(docker, {
			project: 'shop-production',
			proxy: 'caddy',
			ports,
		}).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeProxyClash);
		expect((error as Error).message).toContain("proxy to 'traefik'");
	});

	it('accepts the stack’s own proxy holding them', async () => {
		const traefik = fakeDocker({
			holders: {
				443: [{ container: 'gkm-edge-traefik-1', project: 'gkm-edge' }],
			},
		});
		await assertEdgePorts(traefik.docker, {
			project: 'shop-production',
			proxy: 'traefik',
			ports,
		});
		const caddy = fakeDocker({
			holders: {
				443: [{ container: 'c', project: 'shop-production', service: 'caddy' }],
			},
		});
		await assertEdgePorts(caddy.docker, {
			project: 'shop-production',
			proxy: 'caddy',
			ports,
		});
	});
});

describe('deploy.compose.proxy and tls', () => {
	const stages = { local: 'development', deployed: ['staging', 'production'] };

	it('is caddy by default, for every stage, and always on the local one', () => {
		expect(proxyFor(undefined, 'production', false)).toBe('caddy');
		expect(proxyFor({ proxy: 'traefik' }, 'production', false)).toBe('traefik');
		expect(proxyFor({ proxy: 'traefik' }, 'development', true)).toBe('caddy');
		expect(proxyFor({ proxy: { staging: 'traefik' } }, 'staging', false)).toBe(
			'traefik',
		);
		expect(
			proxyFor({ proxy: { staging: 'traefik' } }, 'production', false),
		).toBe('caddy');
	});

	it('refuses a stage the workspace does not have, and a certificate for the local stage', () => {
		expect(() =>
			checkComposeStages({ proxy: { prod: 'traefik' } }, stages),
		).toThrow(ComposeStageUnknown);
		expect(() =>
			checkComposeStages(
				{ tls: { development: { certFile: 'a', keyFile: 'b' } } },
				stages,
			),
		).toThrow(ComposeTlsOnLocalStage);
		expect(() =>
			checkComposeStages(
				{
					proxy: { staging: 'traefik' },
					tls: { production: { certFile: 'a', keyFile: 'b' } },
				},
				stages,
			),
		).not.toThrow();
	});

	it('is checked by the workspace schema, with the same messages', () => {
		const config = (compose: unknown) => ({
			name: 'shop',
			stages,
			deploy: { compose },
		});

		expect(
			safeValidateWorkspaceConfig(config({ proxy: 'traefik' })).success,
		).toBe(true);
		expect(
			safeValidateWorkspaceConfig(config({ proxy: { staging: 'traefik' } }))
				.success,
		).toBe(true);
		expect(
			safeValidateWorkspaceConfig(config({ proxy: 'nginx' })).success,
		).toBe(false);
		const unknown = safeValidateWorkspaceConfig(
			config({ proxy: { prod: 'traefik' } }),
		);
		expect(unknown.error?.issues[0]?.message).toContain("the stage 'prod'");
		const local = safeValidateWorkspaceConfig(
			config({ tls: { development: { certFile: 'a', keyFile: 'b' } } }),
		);
		expect(local.error?.issues[0]?.message).toContain("Caddy's local CA");
		expect(
			safeValidateWorkspaceConfig(
				config({ tls: { production: { certFile: 'a' } } }),
			).success,
		).toBe(false);
	});
});

describe('a stack behind the shared edge', () => {
	let dir: string;
	let workspace: NormalizedWorkspace;
	let manifest: ConstructManifest;
	let runnables: Record<string, string[]>;
	let background: Record<string, string[]>;

	beforeAll(async () => {
		dir = realpathSync(await createTempDir('gkm-compose-traefik-'));
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			logs: { public: { allow: ['203.0.113.7'] } },
			compose: { proxy: 'traefik' },
		});
		({ workspace, manifest, runnables, background } =
			await loadComposeApp(dir));
	});
	afterAll(async () => {
		await cleanupDir(dir);
	});

	const production: StageSecrets = {
		...initStageSecrets('production'),
		seed: 'a-random-seed',
		custom: {
			AUTH_SECRET: 'the-production-signing-secret',
			REDIS_PASSWORD: 'the-redis-password',
			ZO_ROOT_USER_PASSWORD: 'Strong-Passw0rd!',
		},
	};

	function stack(overrides: Partial<StackInput> = {}): ComposeStack {
		const stage = overrides.stage ?? 'production';
		return composeStack({
			workspace,
			manifest,
			runnables,
			background,
			stage,
			identity: deployIdentity(workspace, stage),
			images: {
				mode: 'pull',
				tag: 'v1.4.0',
				registry: 'registry.example.com/acme',
			},
			secrets: production,
			ports: {},
			...overrides,
		});
	}

	it('runs no Caddy of its own, and registers its routes with the edge', () => {
		const s = stack();

		expect(s.proxy).toBe('traefik');
		expect(s.caddyfile).toBeUndefined();
		expect(s.compose.services.caddy).toBeUndefined();
		expect(s.compose.volumes).not.toHaveProperty('caddy-data');
		expect(s.routes.map((route) => route.name)).toEqual([
			'api',
			'auth',
			'web',
			'openobserve',
		]);
		const file = parse(s.traefik!);
		expect(Object.keys(file.http.routers)).toEqual([
			'compose-app-production-api',
			'compose-app-production-auth',
			'compose-app-production-web',
			'compose-app-production-openobserve',
		]);
		expect(file.http.middlewares).toEqual({
			'compose-app-production-openobserve-allow': {
				ipAllowList: { sourceRange: ['203.0.113.7'] },
			},
		});
	});

	it('puts only its public services on the shared network, each under a unique alias', () => {
		const { services, networks } = stack().compose;

		expect(networks).toEqual({ edge: { name: 'gkm-edge', external: true } });
		for (const name of ['api', 'auth', 'web', 'openobserve']) {
			expect(services[name]?.networks).toEqual({
				default: { aliases: [`compose-app-production-${name}`] },
				edge: { aliases: [`compose-app-production-${name}`] },
			});
		}
		for (const name of ['postgres', 'redis', 'jobs']) {
			expect(services[name]?.networks).toBeUndefined();
		}
	});

	it('reaches its own public services by their aliases, which no other stack has', () => {
		const s = stack();
		const api = s.apps.find((app) => app.name === 'api')!;
		const auth = s.apps.find((app) => app.name === 'auth')!;

		// The API calls the auth server across the network by its alias.
		expect(api.env?.AUTH_URL).toBe('http://compose-app-production-auth:3001');
		// The auth server trusts the browser's origin and the API's alias.
		expect(auth.env?.AUTH_TRUSTED_ORIGINS?.split(',')).toEqual(
			expect.arrayContaining([
				'https://shop.example.com',
				'http://compose-app-production-api:3000',
			]),
		);
		// Telemetry goes to OpenObserve by its alias, as it is on the edge.
		expect(api.env?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
			'http://compose-app-production-openobserve:5080/api/default',
		);
		// What is not on the shared network keeps its bare name.
		expect(api.env?.DATABASE_URL).toMatch(/@postgres:5432\//);
	});

	it('keeps Caddy for the local stage, whatever is configured', () => {
		const local = stack({
			stage: 'development',
			localCredentials: TEST_CREDENTIALS,
			secrets: null,
			images: { mode: 'build', tag: 'abc' },
		});

		expect(local.proxy).toBe('caddy');
		expect(local.caddyfile).toContain('tls internal');
		expect(local.traefik).toBeUndefined();
		expect(local.compose.networks).toBeUndefined();
	});
});

describe('gkm compose with proxy: traefik', { timeout: 60_000 }, () => {
	let dir: string;
	let home: string;
	const registry = [
		'registry.example.com/acme/compose-app/compose-app-api:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-auth:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-jobs:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-web:v1.4.0-production',
	];

	beforeEach(async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		dir = realpathSync(await createTempDir('gkm-compose-traefik-cmd-'));
		mkdirSync(join(dir, 'certs'));
		writeFileSync(join(dir, 'certs', 'shop.pem'), 'CERT');
		writeFileSync(join(dir, 'certs', 'shop.key'), 'KEY');
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			compose: {
				proxy: { production: 'traefik' },
				tls: {
					production: {
						certFile: 'certs/shop.pem',
						keyFile: 'certs/shop.key',
					},
				},
			},
		});
		home = realpathSync(await createTempDir('gkm-compose-traefik-home-'));
		vi.stubEnv('GKM_HOME', home);
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await cleanupDir(dir);
		await cleanupDir(home);
	});

	const release = async (
		holders: Parameters<typeof fakeDocker>[0]['holders'] = {},
	) => {
		const fake = fakeDocker({ registry, holders });
		const result = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v1.4.0' },
			{
				docker: fake.docker,
				probe: async (request) => {
					fake.calls.push({ op: 'probe', args: request });
					return 200;
				},
				revision: async () => 'abc1234',
				sql: () => ({ query: async () => [] }),
				logins: signedIn,
				migrate: async () => [],
				seed: async () => [],
			},
		);
		return { ...fake, result };
	};

	it('starts the edge before the stack, registers after it is up, and asks through the edge', async () => {
		const { calls, ops } = await release();
		const sequence = ops();

		// The network and the edge first, then the infrastructure.
		expect(sequence.indexOf('network')).toBeLessThan(sequence.indexOf('up'));
		expect(calls.filter((call) => call.op === 'up')).toEqual([
			{ op: 'up', args: ['traefik'], edge: true },
			{ op: 'up', args: ['postgres', 'redis'] },
			{ op: 'up', args: 'all' },
		]);

		const edge = join(home, 'edge');
		const file = parse(
			readFileSync(
				join(edge, 'dynamic', 'compose-app-production.yml'),
				'utf-8',
			),
		);
		expect(file.http.routers['compose-app-production-api'].tls).toEqual({});
		expect(file.tls.certificates).toEqual([
			{
				certFile: '/etc/gkm-edge/certs/compose-app-production.crt',
				keyFile: '/etc/gkm-edge/certs/compose-app-production.key',
			},
		]);
		expect(
			readFileSync(join(edge, 'certs', 'compose-app-production.crt'), 'utf-8'),
		).toBe('CERT');

		// The stack's directory has the copy to read, and no Caddyfile.
		const stack = join(dir, '.gkm', 'compose', 'production');
		expect(existsSync(join(stack, 'traefik.yml'))).toBe(true);
		expect(existsSync(join(stack, 'Caddyfile'))).toBe(false);

		// Verify asks the edge on this machine, on its port, by each host.
		const probes = calls
			.filter((call) => call.op === 'probe')
			.map((call) => call.args as Record<string, unknown>);
		expect(probes).toHaveLength(3);
		for (const probe of probes) {
			expect(probe).toMatchObject({ connectTo: '127.0.0.1', connectPort: 443 });
		}
	});

	it("refuses to start while the stack's own Caddy holds the ports, touching nothing", async () => {
		const error = await release({
			443: [
				{
					container: 'compose-app-production-caddy-1',
					project: 'compose-app-production',
					service: 'caddy',
				},
			],
		}).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeProxyClash);
		expect(existsSync(join(home, 'edge'))).toBe(false);
	});

	it('refuses a certificate file that is not there, before anything is written', async () => {
		const { rmSync } = await import('node:fs');
		rmSync(join(dir, 'certs', 'shop.key'));

		const error = await release().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeTlsFileMissing);
		expect(existsSync(join(dir, '.gkm', 'compose', 'production'))).toBe(false);
	});

	it('--down stops the stack and unregisters it, leaving the edge and every other stack', async () => {
		await release();
		const dynamic = join(home, 'edge', 'dynamic');
		writeFileSync(join(dynamic, 'other-production.yml'), 'http: {}\n');

		const { docker, calls } = fakeDocker();
		await composeCommand(
			{ cwd: dir, stage: 'production', down: true },
			{ docker },
		);

		expect(calls).toEqual([{ op: 'down', args: 'compose-app-production' }]);
		expect(readdirSync(dynamic)).toEqual(['other-production.yml']);
		expect(readdirSync(join(home, 'edge', 'certs'))).toEqual([]);
	});
});
