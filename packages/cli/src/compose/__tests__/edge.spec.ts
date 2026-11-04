import { X509Certificate } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
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
import { CommandFailed } from '../../run';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import { ComposeAppsUnhealthy } from '../../target/compose/health';
import { verifyAuthority } from '../../target/compose/phases';
import {
	ensureLocalAuthority,
	issueLocalCertificate,
	localAuthorityPaths,
} from '../../trust/authority';
import { safeValidateWorkspaceConfig } from '../../workspace/schema';
import type {
	ComposeWorkspaceConfig,
	NormalizedWorkspace,
} from '../../workspace/types';
import { edgeCaddyfile } from '../caddyfile';
import { type ComposeDocker, portHolders, publishedPorts } from '../docker';
import {
	assertEdgeHostsFree,
	assertEdgePorts,
	ComposeProxyClash,
	EdgeHostClaimed,
	EdgeWriteFailed,
	edgeRef,
	ensureEdge,
	removeEdgeRoutes,
	routesPath,
	writeEdgeRoutes,
} from '../edge';
import { ComposeTlsFileMissing, composeCommand } from '../index';
import {
	ComposeStageUnknown,
	certificateFor,
	checkComposeStages,
	proxyFor,
} from '../proxy';
import { type EdgeRoute, EdgeRouteConflict } from '../routes';
import { type ComposeStack, composeStack, type StackInput } from '../stack';
import {
	claimsOverlap,
	DEFAULT_EDGE_PROJECT,
	EDGE_NETWORK,
	EDGE_PROJECT,
	edgeClaims,
	edgeCompose,
	edgeProject,
	readEdgeClaims,
	TRAEFIK_IMAGE,
	traefikDynamic,
	traefikDynamicFile,
	traefikStatic,
} from '../traefik';
import {
	loadComposeApp,
	resolvesHere,
	SERVER_IPV4,
	serveFrom,
	writeComposeApp,
} from './__helpers__/composeApp';

/** No Postgres is running here: its login is taken as the one it was given. */
const signedIn: NonNullable<Parameters<typeof composeCommand>[1]>['logins'] =
	async ({ login }) => ({ service: 'postgres', status: 'current', login });

import { edgeOnDisk, fakeDocker, fakeServer } from './__helpers__/fakeDocker';

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
		host: 'uploads.shop.example.com',
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

	it('removes x-gkm-client-ip from every request, in every block', () => {
		const caddyfile = edgeCaddyfile(ROUTES, { tls: { kind: 'acme' } });

		expect(
			caddyfile.match(/^\trequest_header -x-gkm-client-ip$/gm),
		).toHaveLength(ROUTES.length);
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

	it('checks each upstream on its health path, as the Traefik edge does', () => {
		const caddyfile = edgeCaddyfile(ROUTES, { tls: { kind: 'acme' } });
		const block = (host: string) =>
			caddyfile.slice(caddyfile.indexOf(`https://${host} {`)).split('\n}')[0];

		expect(block('api.shop.example.com')).toContain(`		health_uri /health
		health_interval 5s
		health_timeout 3s`);
		expect(block('shop.example.com')).toContain('health_uri /\n');
		// A route with no health path is never checked.
		expect(caddyfile.match(/health_uri/g)).toHaveLength(
			ROUTES.filter((route) => route.health).length,
		);
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

/** A worker SNS pushes to: two subscribers' routes, and nothing else. */
const PUSHED: EdgeRoute = {
	name: 'jobs',
	host: 'jobs.shop.example.com',
	upstreams: [{ service: 'jobs', port: 3000 }],
	streaming: false,
	paths: ['/__gkm/subscribers/onAlert', '/__gkm/subscribers/onSignup'],
	health: '/health',
};

/** A file server over MinIO whose processor patterns go to their own service. */
const PROCESSED: EdgeRoute = {
	name: 'files-assets-server',
	host: 'assets.shop.example.com',
	upstreams: [{ service: 'minio', port: 9000 }],
	streaming: false,
	prefix: '/assets',
	handlers: [
		{
			name: 'assets-processors',
			prefixes: ['/i/', '/pdf/'],
			upstreams: [{ service: 'assets-processors', port: 3000 }],
		},
	],
};

/** A processor unit's own host, which only the CDN may call. */
const ORIGIN: EdgeRoute = {
	name: 'assets-processors',
	host: 'assets-processors.shop.example.com',
	upstreams: [{ service: 'assets-processors', port: 3000 }],
	streaming: false,
	prefixes: ['/i/'],
	requireHeader: { name: 'X-Gkm-Origin-Verify', value: 's3cr3t' },
	health: '/health',
};

describe('a route whose processor paths go elsewhere', () => {
	it('is handled by Caddy in order: the processors, then the bucket', () => {
		const caddyfile = edgeCaddyfile([PROCESSED], { tls: { kind: 'acme' } });

		// A named matcher: `handle` takes one matcher token, and Caddy refuses
		// two paths written inline (checked against `caddy adapt`).
		expect(caddyfile).toContain(`	@handler0 path /i/* /pdf/*
	handle @handler0 {
		reverse_proxy assets-processors:3000
	}`);
		// Every other path is the bucket, as before — inside a handle of its own.
		expect(caddyfile).toContain(`	handle {
		# A bucket, served at a host of its own`);
		expect(caddyfile).toContain('		reverse_proxy minio:9000 {');
		expect(caddyfile.indexOf('handle @handler0')).toBeLessThan(
			caddyfile.indexOf('handle {'),
		);
	});

	it('is a router of its own under Traefik, above the bucket’s', () => {
		const { http } = traefikDynamic([PROCESSED], {
			project: 'shop-production',
			tls: { kind: 'acme' },
		}) as {
			http: {
				routers: Record<
					string,
					{ rule: string; priority?: number; service: string }
				>;
				services: Record<
					string,
					{ loadBalancer: { servers: { url: string }[] } }
				>;
			};
		};

		const handler =
			http.routers['shop-production-files-assets-server-assets-processors'];
		expect(handler).toMatchObject({
			rule: 'Host(`assets.shop.example.com`) && (PathPrefix(`/i/`) || PathPrefix(`/pdf/`))',
			priority: 10_000,
			service: 'shop-production-files-assets-server-assets-processors',
		});
		expect(
			http.services['shop-production-files-assets-server-assets-processors']
				?.loadBalancer.servers,
		).toEqual([{ url: 'http://shop-production-assets-processors:3000' }]);
		expect(http.routers['shop-production-files-assets-server']?.rule).toBe(
			'Host(`assets.shop.example.com`)',
		);
	});

	it('is never combined with a check every handler would need too', () => {
		const conflicted = { ...PROCESSED, allow: ['10.0.0.0/8'] };

		expect(() =>
			edgeCaddyfile([conflicted], { tls: { kind: 'acme' } }),
		).toThrow(EdgeRouteConflict);
		expect(() =>
			traefikDynamic([conflicted], { project: 'p', tls: { kind: 'acme' } }),
		).toThrow(EdgeRouteConflict);
	});
});

describe('an origin only the CDN may call', () => {
	it('refuses, under Caddy, a request without the header, and every other path', () => {
		const caddyfile = edgeCaddyfile([ORIGIN], { tls: { kind: 'acme' } });

		expect(caddyfile).toContain(
			'@forged not header X-Gkm-Origin-Verify "s3cr3t"\n\trespond @forged 403',
		);
		expect(caddyfile).toContain(
			'@elsewhere not path /i/*\n\trespond @elsewhere 404',
		);
		expect(caddyfile.indexOf('respond @forged 403')).toBeLessThan(
			caddyfile.indexOf('reverse_proxy assets-processors:3000'),
		);
	});

	it('matches no Traefik router without the header, or off its prefixes', () => {
		const { http } = traefikDynamic([ORIGIN], {
			project: 'shop-production',
			tls: { kind: 'acme' },
		}) as { http: { routers: Record<string, { rule: string }> } };

		expect(http.routers['shop-production-assets-processors']?.rule).toBe(
			'Host(`assets-processors.shop.example.com`) && (PathPrefix(`/i/`)) && Header(`X-Gkm-Origin-Verify`, `s3cr3t`)',
		);
	});
});

describe('a route that answers only some paths', () => {
	it('is refused by Caddy on every other path, before the upstream', () => {
		const caddyfile = edgeCaddyfile([PUSHED], { tls: { kind: 'acme' } });

		expect(caddyfile).toContain(
			'@elsewhere not path /__gkm/subscribers/onAlert /__gkm/subscribers/onSignup\n\trespond @elsewhere 404',
		);
		// Refused before the proxy is reached, so nothing else is let through.
		expect(caddyfile.indexOf('respond @elsewhere 404')).toBeLessThan(
			caddyfile.indexOf('reverse_proxy jobs:3000'),
		);
	});

	it('matches no Traefik router on any other path', () => {
		const { http } = traefikDynamic([PUSHED], {
			project: 'shop-production',
			tls: { kind: 'acme' },
		}) as { http: { routers: Record<string, { rule: string }> } };

		expect(http.routers['shop-production-jobs']?.rule).toBe(
			'Host(`jobs.shop.example.com`) && (Path(`/__gkm/subscribers/onAlert`) || Path(`/__gkm/subscribers/onSignup`))',
		);
	});

	it('leaves a route without paths answering every one', () => {
		const caddyfile = edgeCaddyfile(ROUTES, { tls: { kind: 'acme' } });
		const { http } = traefikDynamic(ROUTES, {
			project: 'shop-production',
			tls: { kind: 'acme' },
		}) as { http: { routers: Record<string, { rule: string }> } };

		expect(caddyfile).not.toContain('@elsewhere');
		expect(http.routers['shop-production-api']?.rule).toBe(
			'Host(`api.shop.example.com`)',
		);
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

	it('removes x-gkm-client-ip from every request, before anything else', () => {
		const { routers, middlewares } = dynamic().http;

		// An empty value is how Traefik removes a request header.
		expect(middlewares['shop-production-strip-gkm-headers']).toEqual({
			headers: { customRequestHeaders: { 'x-gkm-client-ip': '' } },
		});
		for (const router of Object.values(routers)) {
			expect((router.middlewares as string[])[0]).toBe(
				'shop-production-strip-gkm-headers',
			);
		}
	});

	it('allows only the listed addresses to the logs, with ipAllowList', () => {
		const { routers, middlewares } = dynamic().http;

		expect(routers['shop-production-openobserve']?.middlewares).toEqual([
			'shop-production-strip-gkm-headers',
			'shop-production-openobserve-allow',
		]);
		expect(middlewares['shop-production-openobserve-allow']).toEqual({
			ipAllowList: { sourceRange: ['203.0.113.7', '10.0.0.0/8'] },
		});
		expect(routers['shop-production-api']?.middlewares).toEqual([
			'shop-production-strip-gkm-headers',
		]);
	});

	it("sends a bucket's requests to MinIO under its prefix, with MinIO's own Host", () => {
		const { routers, services, middlewares } = dynamic().http;

		expect(
			routers['shop-production-files-uploads-server']?.middlewares,
		).toEqual([
			'shop-production-strip-gkm-headers',
			'shop-production-files-uploads-server-prefix',
		]);
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

	it('checks each upstream on its health path, as the Traefik edge does', () => {
		const caddyfile = edgeCaddyfile(ROUTES, { tls: { kind: 'acme' } });
		const block = (host: string) =>
			caddyfile.slice(caddyfile.indexOf(`https://${host} {`)).split('\n}')[0];

		expect(block('api.shop.example.com')).toContain(`		health_uri /health
		health_interval 5s
		health_timeout 3s`);
		expect(block('shop.example.com')).toContain('health_uri /\n');
		// A route with no health path is never checked.
		expect(caddyfile.match(/health_uri/g)).toHaveLength(
			ROUTES.filter((route) => route.health).length,
		);
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

	it('is gkm-edge, unless GKM_EDGE_PROJECT names another', () => {
		expect(DEFAULT_EDGE_PROJECT).toBe('gkm-edge');
		expect(edgeProject({})).toBe('gkm-edge');
		expect(edgeProject({ GKM_EDGE_PROJECT: '' })).toBe('gkm-edge');
		expect(edgeProject({ GKM_EDGE_PROJECT: 'gkm-edge-e2e-1a2b3c' })).toBe(
			'gkm-edge-e2e-1a2b3c',
		);
		// Its network is named after it, so a renamed edge shares nothing.
		expect(EDGE_NETWORK).toBe(EDGE_PROJECT);
	});

	it('runs the pinned image on the shared network, with its ACME state on a volume', () => {
		const compose = edgeCompose({
			ports: { https: 443, http: 80 },
			staticConfig: 'x',
			logging: { driver: 'json-file', options: {} },
		}) as {
			name: string;
			services: { traefik: Record<string, unknown> };
			networks: unknown;
			volumes: unknown;
			configs: unknown;
		};

		expect(compose.name).toBe(EDGE_PROJECT);
		expect(compose.services.traefik.image).toBe(TRAEFIK_IMAGE);
		expect(TRAEFIK_IMAGE).toMatch(/^traefik:v3\.\d+\.\d+$/);
		expect(compose.services.traefik.ports).toEqual(['443:443', '80:80']);
		// Two sockets per connection, and the whole port range to open the
		// upstream half from.
		expect(compose.services.traefik.sysctls).toEqual({
			'net.ipv4.ip_local_port_range': '1024 65535',
		});
		expect(compose.services.traefik.ulimits).toEqual({
			nofile: { soft: 1_048_576, hard: 1_048_576 },
		});
		// Nothing mounted from a path: the deploy runs where the server is
		// not, so everything is a volume on the server or inline.
		expect(compose.services.traefik.volumes).toEqual([
			'dynamic:/etc/gkm-edge/dynamic',
			'certs:/etc/gkm-edge/certs',
			'acme:/acme',
		]);
		expect(compose.services.traefik.configs).toEqual([
			{ source: 'traefik', target: '/etc/traefik/traefik.yml' },
		]);
		expect(compose.configs).toEqual({ traefik: { content: 'x' } });
		expect(compose.networks).toEqual({
			edge: { name: EDGE_NETWORK, external: true },
		});
		expect(compose.volumes).toEqual({ acme: {}, dynamic: {}, certs: {} });
		// The DNS challenge's key, read from the file a stage with a wildcard
		// site writes — never a key in the compose file itself.
		expect(compose.services.traefik.environment).toEqual({
			AWS_SHARED_CREDENTIALS_FILE: '/etc/gkm-edge/certs/aws-credentials',
			AWS_REGION: 'us-east-1',
		});
	});

	describe('through the engine', () => {
		let dir: string;
		beforeEach(async () => {
			dir = realpathSync(await createTempDir('gkm-edge-'));
		});
		afterEach(async () => {
			await cleanupDir(dir);
		});

		it('creates its network and starts it on the engine, from a file written here', async () => {
			const { docker, calls } = fakeDocker();
			const logging = { driver: 'json-file', options: {} };
			const file = join(dir, 'gkm-edge.yml');
			const host = 'ssh://deploy@203.0.113.10';

			await ensureEdge(docker, {
				file,
				ports: { https: 443, http: 80 },
				logging,
				host,
			});

			expect(calls).toEqual([
				{ op: 'network', args: EDGE_NETWORK, host },
				{ op: 'up', args: ['traefik'], edge: true, host },
			]);
			const compose = parse(readFileSync(file, 'utf-8'));
			expect(compose.name).toBe(EDGE_PROJECT);
			expect(parse(compose.configs.traefik.content).providers).toEqual({
				file: { directory: '/etc/gkm-edge/dynamic', watch: true },
			});

			// A second run with the same ports leaves the file as it was.
			const before = statSync(file).mtimeMs;
			await ensureEdge(docker, {
				file,
				ports: { https: 443, http: 80 },
				logging,
			});
			expect(statSync(file).mtimeMs).toBe(before);

			// Moved ports change its configuration — and the label that
			// recreates it.
			const label = () =>
				parse(readFileSync(file, 'utf-8')).services.traefik.labels[
					'dev.geekmidas.edge.config'
				];
			const first = label();
			await ensureEdge(docker, {
				file,
				ports: { https: 8443, http: 8080 },
				logging,
			});
			expect(label()).not.toBe(first);
		});

		it("writes a stack's file whole, with its certificate first, and removes both", async () => {
			const volumes = join(dir, 'edge');
			const { docker, calls } = fakeDocker({ exec: edgeOnDisk(volumes) });
			const edge = edgeRef(join(dir, 'gkm-edge.yml'), {
				host: 'ssh://deploy@203.0.113.10',
			});
			const files = await writeEdgeRoutes(
				docker,
				edge,
				'shop-production',
				'http: {}\n',
				{ cert: 'CERT', key: 'KEY' },
			);

			expect(files.at(-1)).toBe(routesPath('shop-production'));
			// Every write went to the edge's container on the server's engine,
			// the certificate before the routes.
			const written = calls
				.filter((call) => call.op === 'exec')
				.map((call) => {
					const { service, command } = call.args as {
						service: string;
						command: string[];
					};
					expect(service).toBe('traefik');
					expect(call.host).toBe('ssh://deploy@203.0.113.10');
					return command[4];
				});
			expect(written).toEqual([
				'/etc/gkm-edge/certs/shop-production.crt',
				'/etc/gkm-edge/certs/shop-production.key',
				'/etc/gkm-edge/dynamic/shop-production.yml',
			]);
			expect(
				readFileSync(join(volumes, 'dynamic', 'shop-production.yml'), 'utf-8'),
			).toBe('http: {}\n');
			expect(
				readFileSync(join(volumes, 'certs', 'shop-production.crt'), 'utf-8'),
			).toBe('CERT');
			expect(
				statSync(join(volumes, 'certs', 'shop-production.key')).mode & 0o777,
			).toBe(0o600);
			// Nothing half written is left for the edge to read.
			expect(readdirSync(join(volumes, 'dynamic'))).toEqual([
				'shop-production.yml',
			]);

			expect(await removeEdgeRoutes(docker, edge, 'shop-production')).toBe(
				true,
			);
			expect(readdirSync(join(volumes, 'dynamic'))).toEqual([]);
			expect(readdirSync(join(volumes, 'certs'))).toEqual([]);
			expect(await removeEdgeRoutes(docker, edge, 'shop-production')).toBe(
				false,
			);
		});

		it('leaves every other stack registered', async () => {
			const volumes = join(dir, 'edge');
			const { docker } = fakeDocker({ exec: edgeOnDisk(volumes) });
			const edge = edgeRef(join(dir, 'gkm-edge.yml'));
			await writeEdgeRoutes(docker, edge, 'a-production', 'http: {}\n');
			await writeEdgeRoutes(docker, edge, 'b-staging', 'http: {}\n');

			await removeEdgeRoutes(docker, edge, 'a-production');

			expect(readdirSync(join(volumes, 'dynamic'))).toEqual(['b-staging.yml']);
		});

		it('says so when the edge is not running to be written to', async () => {
			const { docker } = fakeDocker({
				exec: () => ({
					code: null,
					stdout: '',
					stderr: 'traefik is not running',
				}),
			});
			const edge = edgeRef(join(dir, 'gkm-edge.yml'));

			await expect(
				writeEdgeRoutes(docker, edge, 'a-production', 'http: {}\n'),
			).rejects.toBeInstanceOf(EdgeWriteFailed);
			expect(await removeEdgeRoutes(docker, edge, 'a-production')).toBe(false);
		});
	});
});

/** A wildcard site's route: every label under its domain but `www`, `staging`. */
const WILDCARD: EdgeRoute = {
	name: 'tenants',
	host: '*.example.com',
	upstreams: [{ service: 'tenants', port: 3003 }],
	streaming: true,
	wildcard: {
		domain: 'example.com',
		except: ['www', 'staging'],
		tls: { kind: 'dns' },
	},
};

describe('the hosts a stack claims on the edge', () => {
	const file = (routes: EdgeRoute[], project = 'shop-production') =>
		traefikDynamicFile(routes, { project, tls: { kind: 'acme' } });

	it('carries them in a comment the edge ignores, read back as written', () => {
		const written = file([...ROUTES, WILDCARD]);

		// A comment: Traefik refuses a file over a key it does not know.
		expect(written).toMatch(/^# gkm-claims: \[/m);
		expect(Object.keys(parse(written))).toEqual(['http']);
		expect(readEdgeClaims(written)).toEqual(edgeClaims([...ROUTES, WILDCARD]));
		expect(readEdgeClaims(written)).toContainEqual({
			wildcard: 'example.com',
			except: ['www', 'staging'],
		});
	});

	it("reads a file without the comment from its routers' rules", () => {
		const old = file([...ROUTES, WILDCARD])
			.split('\n')
			.filter((line) => !line.startsWith('# gkm-claims:'))
			.join('\n');

		const claims = readEdgeClaims(old);

		for (const { host } of ROUTES) expect(claims).toContainEqual({ host });
		expect(claims).toContainEqual({
			wildcard: 'example.com',
			except: ['www', 'staging'],
		});
		// Never a host a rule leaves out.
		expect(claims).not.toContainEqual({ host: 'www.example.com' });
	});

	it('reads every host of a rule that names several', () => {
		const claims = readEdgeClaims(`http:
  routers:
    a:
      rule: Host(\`a.example.org\`) || Host(\`B.example.org\`)
      service: a
`);

		expect(claims).toEqual([
			{ host: 'a.example.org' },
			{ host: 'b.example.org' },
		]);
	});

	it('claims nothing in a file that routes nothing', () => {
		expect(readEdgeClaims('# Unregistered by gkm compose --down.\n')).toEqual(
			[],
		);
		expect(readEdgeClaims('http: {}\n')).toEqual([]);
		expect(readEdgeClaims('not: [yaml')).toEqual([]);
	});

	it('meets another claim on one host, or one label under a wildcard', () => {
		const wildcard = { wildcard: 'example.com', except: ['staging'] };

		expect(
			claimsOverlap({ host: 'api.example.com' }, { host: 'api.example.com' }),
		).toBe('api.example.com');
		expect(
			claimsOverlap({ host: 'api.example.com' }, { host: 'web.example.com' }),
		).toBeUndefined();
		expect(claimsOverlap({ host: 'acme.example.com' }, wildcard)).toBe(
			'acme.example.com',
		);
		expect(claimsOverlap(wildcard, { host: 'acme.example.com' })).toBe(
			'acme.example.com',
		);
		expect(
			claimsOverlap(wildcard, { wildcard: 'example.com', except: [] }),
		).toBe('*.example.com');
		// A label it leaves out, two labels down, and the domain itself are
		// not the wildcard's.
		expect(claimsOverlap({ host: 'staging.example.com' }, wildcard)).toBe(
			undefined,
		);
		expect(
			claimsOverlap({ host: 'api.staging.example.com' }, wildcard),
		).toBeUndefined();
		expect(claimsOverlap({ host: 'example.com' }, wildcard)).toBeUndefined();
		expect(
			claimsOverlap(wildcard, { wildcard: 'staging.example.com', except: [] }),
		).toBeUndefined();
	});

	describe('through the engine', () => {
		let dir: string;
		let volumes: string;
		beforeEach(async () => {
			dir = realpathSync(await createTempDir('gkm-edge-claims-'));
			volumes = join(dir, 'edge');
		});
		afterEach(async () => {
			await cleanupDir(dir);
		});

		const engine = () => {
			const fake = fakeDocker({ exec: edgeOnDisk(volumes) });
			const edge = edgeRef(join(dir, 'gkm-edge.yml'), {
				host: 'ssh://deploy@203.0.113.10',
			});
			return { ...fake, edge };
		};
		const listing = () => ({
			dynamic: readdirSync(join(volumes, 'dynamic')).sort(),
			certs: readdirSync(join(volumes, 'certs')).sort(),
		});

		it('refuses a host another project routes, writing nothing', async () => {
			const { docker, edge, calls } = engine();
			await writeEdgeRoutes(
				docker,
				edge,
				'shop-production',
				file(ROUTES, 'shop-production'),
			);
			const before = listing();
			calls.length = 0;

			const error = await writeEdgeRoutes(
				docker,
				edge,
				'market-production',
				file([ROUTES[0]!], 'market-production'),
				{ cert: 'CERT', key: 'KEY' },
			).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(EdgeHostClaimed);
			expect(error).toMatchObject({
				host: 'api.shop.example.com',
				owner: 'shop-production',
				project: 'market-production',
			});
			expect((error as Error).message).toContain('gkm compose');
			expect((error as Error).message).toContain('--down');
			// Not its certificate, not its routes.
			expect(listing()).toEqual(before);
			// Read through the edge's container on the server's engine.
			for (const call of calls) {
				expect(call.host).toBe('ssh://deploy@203.0.113.10');
				expect(call.args).toMatchObject({ project: EDGE_PROJECT });
			}
		});

		it('reads the edge it is given, under whatever name GKM_EDGE_PROJECT gave it', async () => {
			const { docker, edge, calls } = engine();
			const renamed = { ...edge, project: 'gkm-edge-e2e-1a2b3c' };
			await writeEdgeRoutes(
				docker,
				renamed,
				'shop-production',
				file(ROUTES, 'shop-production'),
			);
			calls.length = 0;

			const error = await assertEdgeHostsFree(
				docker,
				renamed,
				'market-production',
				file([ROUTES[0]!], 'market-production'),
			).catch((e: unknown) => e);

			expect(error).toMatchObject({
				name: 'EdgeHostClaimed',
				edge: 'gkm-edge-e2e-1a2b3c',
			});
			expect((error as Error).message).toContain('(gkm-edge-e2e-1a2b3c)');
			for (const call of calls) {
				expect(call.args).toMatchObject({ project: 'gkm-edge-e2e-1a2b3c' });
			}
		});

		it("refuses a host under another project's wildcard, and a wildcard over another's host", async () => {
			const { docker, edge } = engine();
			await writeEdgeRoutes(
				docker,
				edge,
				'tenants-production',
				file([WILDCARD], 'tenants-production'),
			);

			await expect(
				assertEdgeHostsFree(
					docker,
					edge,
					'acme-production',
					file(
						[{ ...ROUTES[0]!, host: 'acme.example.com' }],
						'acme-production',
					),
				),
			).rejects.toMatchObject({
				name: 'EdgeHostClaimed',
				host: 'acme.example.com',
				owner: 'tenants-production',
			});
			// A label the wildcard leaves out is free: a stage of its own.
			await writeEdgeRoutes(
				docker,
				edge,
				'tenants-staging',
				file(
					[{ ...ROUTES[0]!, host: 'staging.example.com' }],
					'tenants-staging',
				),
			);

			// The other way round: a wildcard over a host already routed.
			await expect(
				writeEdgeRoutes(
					docker,
					edge,
					'other-production',
					file(
						[{ ...WILDCARD, wildcard: { ...WILDCARD.wildcard!, except: [] } }],
						'other-production',
					),
				),
			).rejects.toBeInstanceOf(EdgeHostClaimed);
			expect(listing().dynamic).toEqual([
				'tenants-production.yml',
				'tenants-staging.yml',
			]);
		});

		it('replaces its own routes on a redeploy', async () => {
			const { docker, edge } = engine();
			await writeEdgeRoutes(
				docker,
				edge,
				'shop-production',
				file(ROUTES, 'shop-production'),
			);

			await writeEdgeRoutes(
				docker,
				edge,
				'shop-production',
				file(ROUTES.slice(0, 2), 'shop-production'),
			);

			expect(listing().dynamic).toEqual(['shop-production.yml']);
			expect(
				readEdgeClaims(
					readFileSync(
						join(volumes, 'dynamic', 'shop-production.yml'),
						'utf-8',
					),
				),
			).toEqual(edgeClaims(ROUTES.slice(0, 2)));
		});

		it('frees the host once the other project is down', async () => {
			const { docker, edge } = engine();
			await writeEdgeRoutes(
				docker,
				edge,
				'shop-production',
				file(ROUTES, 'shop-production'),
			);
			const market = file([ROUTES[0]!], 'market-production');
			await expect(
				writeEdgeRoutes(docker, edge, 'market-production', market),
			).rejects.toBeInstanceOf(EdgeHostClaimed);

			await removeEdgeRoutes(docker, edge, 'shop-production');
			await writeEdgeRoutes(docker, edge, 'market-production', market);

			expect(listing().dynamic).toEqual(['market-production.yml']);
		});

		it('reads only route files, and nothing where the edge is not running', async () => {
			const { docker, edge } = engine();
			mkdirSync(join(volumes, 'dynamic'), { recursive: true });
			// A rename in flight, and something that is not a stack's.
			writeFileSync(
				join(volumes, 'dynamic', 'shop-production.yml.tmp'),
				file(ROUTES, 'shop-production'),
			);
			writeFileSync(join(volumes, 'dynamic', 'notes.txt'), 'Host(`x`)');
			await assertEdgeHostsFree(
				docker,
				edge,
				'market-production',
				file(ROUTES, 'market-production'),
			);

			const { docker: stopped } = fakeDocker({
				exec: () => ({ code: null, stdout: '', stderr: 'not running' }),
			});
			await assertEdgeHostsFree(
				stopped,
				edge,
				'market-production',
				file(ROUTES, 'market-production'),
			);
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
			engine: {},
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
						container: `${EDGE_PROJECT}-traefik-1`,
						project: EDGE_PROJECT,
						service: 'traefik',
					},
				],
			},
		});

		const error = await assertEdgePorts(docker, {
			project: 'shop-production',
			proxy: 'caddy',
			ports,
			engine: {},
		}).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeProxyClash);
		expect((error as Error).message).toContain("proxy to 'traefik'");
	});

	it('accepts the stack’s own proxy holding them', async () => {
		const traefik = fakeDocker({
			holders: {
				443: [
					{ container: `${EDGE_PROJECT}-traefik-1`, project: EDGE_PROJECT },
				],
			},
		});
		await assertEdgePorts(traefik.docker, {
			project: 'shop-production',
			proxy: 'traefik',
			ports,
			engine: {},
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
			engine: {},
		});
	});
});

describe('deploy.compose.proxy and tls', () => {
	const stages = { local: 'development', deployed: ['staging', 'production'] };

	it.each([
		// [proxy, stage, local, expected]
		[undefined, 'production', false, 'caddy'],
		[undefined, 'development', true, 'caddy'],
		// The string form is the deployed stages': the local one keeps Caddy.
		['traefik', 'production', false, 'traefik'],
		['traefik', 'development', true, 'caddy'],
		['caddy', 'production', false, 'caddy'],
		// A map sets each stage it names — the local one included.
		[{ staging: 'traefik' }, 'staging', false, 'traefik'],
		[{ staging: 'traefik' }, 'production', false, 'caddy'],
		[{ staging: 'traefik' }, 'development', true, 'caddy'],
		[{ development: 'traefik' }, 'development', true, 'traefik'],
		[{ development: 'traefik' }, 'production', false, 'caddy'],
		[
			{ development: 'traefik', production: 'traefik' },
			'development',
			true,
			'traefik',
		],
		[
			{ development: 'caddy', production: 'traefik' },
			'development',
			true,
			'caddy',
		],
	] as const)('proxy %j on %s (local: %s) is %s', (proxy, stage, local, expected) => {
		expect(
			proxyFor(proxy === undefined ? undefined : { proxy }, stage, local),
		).toBe(expected);
	});

	it('takes a certificate for any stage, the local one included, its paths made absolute', () => {
		expect(() =>
			checkComposeStages(
				{
					tls: {
						development: { certFile: 'a', keyFile: 'b', caFile: 'c' },
						production: { certFile: 'a', keyFile: 'b' },
					},
				},
				stages,
			),
		).not.toThrow();
		expect(
			certificateFor(
				{
					tls: {
						development: {
							certFile: 'certs/dev.pem',
							keyFile: '/abs/dev-key.pem',
							caFile: 'certs/root.pem',
						},
					},
				},
				'development',
				'/work',
			),
		).toEqual({
			certFile: '/work/certs/dev.pem',
			keyFile: '/abs/dev-key.pem',
			caFile: '/work/certs/root.pem',
		});
	});

	it('refuses a stage the workspace does not have', () => {
		expect(() =>
			checkComposeStages({ proxy: { prod: 'traefik' } }, stages),
		).toThrow(ComposeStageUnknown);
		expect(() =>
			checkComposeStages(
				{ tls: { prod: { certFile: 'a', keyFile: 'b' } } },
				stages,
			),
		).toThrow(ComposeStageUnknown);
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
		expect(
			safeValidateWorkspaceConfig(
				config({
					proxy: { development: 'traefik', production: 'traefik' },
					tls: {
						development: { certFile: 'a', keyFile: 'b', caFile: 'c' },
					},
				}),
			).success,
		).toBe(true);
		expect(
			safeValidateWorkspaceConfig(
				config({
					tls: { development: { certFile: 'a', keyFile: 'b', caFile: '' } },
				}),
			).success,
		).toBe(false);
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
	let background: Record<string, string[]>;

	beforeAll(async () => {
		dir = realpathSync(await createTempDir('gkm-compose-traefik-'));
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			telemetry: true,
			deployTelemetry: {
				production: {
					provider: 'self-hosted',
					public: { allow: ['203.0.113.7'] },
				},
			},
			compose: { proxy: 'traefik' },
		});
		({ workspace, manifest, background } = await loadComposeApp(dir));
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
		// Each route twice: for everyone, and for the stack's own services,
		// which prove it with its token and keep gkm's client address.
		expect(Object.keys(file.http.routers)).toEqual([
			'compose-app-production-api',
			'compose-app-production-api-stack',
			'compose-app-production-auth',
			'compose-app-production-auth-stack',
			'compose-app-production-web',
			'compose-app-production-web-stack',
			'compose-app-production-openobserve',
			'compose-app-production-openobserve-stack',
		]);
		const token = s.apps.find((app) => app.name === 'api')!.env!
			.GKM_EDGE_TOKEN!;
		expect(token).toBeTruthy();
		const api = file.http.routers['compose-app-production-api'];
		const own = file.http.routers['compose-app-production-api-stack'];
		expect(api.middlewares).toEqual([
			'compose-app-production-strip-gkm-headers',
		]);
		expect(own.rule).toBe(
			`${api.rule} && Header(\`x-gkm-edge-token\`, \`${token}\`)`,
		);
		expect(own.service).toBe(api.service);
		expect(own).not.toHaveProperty('middlewares');
		expect(file.http.middlewares).toEqual({
			'compose-app-production-strip-gkm-headers': {
				headers: { customRequestHeaders: { 'x-gkm-client-ip': '' } },
			},
			'compose-app-production-openobserve-allow': {
				ipAllowList: { sourceRange: ['203.0.113.7'] },
			},
		});
	});

	it('puts only its public services on the shared network, each under a unique alias', () => {
		const { services, networks } = stack().compose;

		expect(networks).toEqual({
			edge: { name: EDGE_NETWORK, external: true },
		});
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

		// The API calls the auth server at its public address, through the edge.
		expect(api.env?.AUTH_URL).toBe(auth.url);
		// The auth server trusts the browser's origin and the API's, both
		// public — no alias on the network calls it.
		expect(auth.env?.AUTH_TRUSTED_ORIGINS?.split(',')).toEqual(
			expect.arrayContaining(['https://shop.example.com', api.url]),
		);
		expect(auth.env?.AUTH_TRUSTED_ORIGINS).not.toContain(
			'compose-app-production-api:3000',
		);
		// Telemetry goes to OpenObserve by its alias, as it is on the edge.
		expect(api.env?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
			'http://compose-app-production-openobserve:5080/api/default',
		);
		// What is not on the shared network keeps its bare name.
		expect(api.env?.DATABASE_URL).toMatch(/@postgres:5432\//);
	});

	it('keeps Caddy for the local stage when proxy is one value for the deployed stages', () => {
		const local = stack({
			stage: 'development',
			localCredentials: TEST_CREDENTIALS,
			secrets: null,
			images: { mode: 'build', tag: 'abc' },
		});

		expect(local.proxy).toBe('caddy');
		expect(local.caddyfile).toContain(
			'tls /etc/caddy/tls/cert.pem /etc/caddy/tls/key.pem',
		);
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
		await serveFrom(dir);
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await cleanupDir(dir);
		await cleanupDir(home);
	});

	/** The edge's volumes, on the server — here, a directory. */
	const volumes = () => join(home, 'edge');

	const release = async (
		holders: NonNullable<Parameters<typeof fakeDocker>[0]>['holders'] = {},
		docker: Partial<ComposeDocker> = {},
	) => {
		const fake = fakeDocker({ registry, holders, exec: edgeOnDisk(volumes()) });
		const result = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v1.4.0' },
			{
				lookup: resolvesHere,
				docker: { ...fake.docker, ...docker },
				server: fakeServer([]),
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

	it('starts the edge before the stack, registers before waiting on it, and asks through the edge', async () => {
		const { calls, ops } = await release();
		const sequence = ops();
		const host = `ssh://deploy@${SERVER_IPV4}`;

		// The network and the edge first, then the infrastructure — all on
		// the server's engine.
		expect(sequence.indexOf('network')).toBeLessThan(sequence.indexOf('up'));
		expect(calls.filter((call) => call.op === 'up')).toEqual([
			{ op: 'up', args: ['traefik'], edge: true, host },
			{ op: 'up', args: ['postgres', 'redis'], host },
			{ op: 'up', args: 'all', host },
		]);
		// Registered before the stack is waited on: a route to an app not up
		// yet answers 502 rather than going missing.
		const registered = calls.findIndex(
			(call) =>
				call.op === 'exec' &&
				JSON.stringify(call.args).includes(
					'dynamic/compose-app-production.yml',
				),
		);
		expect(registered).toBeGreaterThan(-1);
		expect(registered).toBeLessThan(
			calls.findIndex((call) => call.op === 'up' && call.args === 'all'),
		);

		const edge = volumes();
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

		// Verify asks the edge on the server, on its port, by each host.
		const probes = calls
			.filter((call) => call.op === 'probe')
			.map((call) => call.args as Record<string, unknown>);
		expect(probes).toHaveLength(3);
		for (const probe of probes) {
			expect(probe).toMatchObject({ connectTo: SERVER_IPV4, connectPort: 443 });
		}
	});

	it('keeps every route registered when an app never turns healthy, then fails naming it', async () => {
		const error = await release(
			{},
			{
				// What `up --wait` does when one container fails its check.
				async up(stack, services) {
					if (!services && stack.project === 'compose-app-production') {
						throw new CommandFailed('docker', ['compose', 'up'], 1, null);
					}
				},
				health: async (_stack, service) =>
					service === 'api' ? 'unhealthy' : 'healthy',
			},
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeAppsUnhealthy);
		expect((error as ComposeAppsUnhealthy).apps).toEqual([
			{ app: 'api', url: 'docker:api', last: 'unhealthy' },
		]);
		// Docker's own check failed, not a request through the edge.
		expect((error as ComposeAppsUnhealthy).via).toBe('docker');
		expect((error as ComposeAppsUnhealthy).message).toContain(
			"this container's health check has not passed",
		);
		expect((error as ComposeAppsUnhealthy).message).toContain(
			'  - api: Docker reports it unhealthy',
		);
		expect((error as ComposeAppsUnhealthy).message).toContain(
			'docker compose -p compose-app-production logs api',
		);
		expect((error as ComposeAppsUnhealthy).message).not.toContain(
			'answer through',
		);
		// The healthy apps are still routed — and so is the one that is not,
		// which answers 502 until it is up.
		const file = parse(
			readFileSync(
				join(volumes(), 'dynamic', 'compose-app-production.yml'),
				'utf-8',
			),
		);
		expect(Object.keys(file.http.routers)).toEqual(
			expect.arrayContaining([
				'compose-app-production-api',
				'compose-app-production-web',
			]),
		);
	});

	it('throws what up threw when every app is healthy: the failure was not health', async () => {
		const failed = new CommandFailed('docker', ['compose', 'up'], 1, null);
		const error = await release(
			{},
			{
				async up(stack, services) {
					if (!services && stack.project === 'compose-app-production') {
						throw failed;
					}
				},
			},
		).catch((e: unknown) => e);

		expect(error).toBe(failed);
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
		expect(readdirSync(join(volumes(), 'dynamic'))).toEqual([]);
	});

	it('refuses a certificate file that is not there, before anything is written', async () => {
		const { rmSync } = await import('node:fs');
		rmSync(join(dir, 'certs', 'shop.key'));

		const error = await release().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeTlsFileMissing);
		expect(existsSync(join(dir, '.gkm', 'compose', 'production'))).toBe(false);
	});

	it('refuses a host another project on the edge routes, before anything is built, started or written', async () => {
		// Another workspace's stack, routing one of this stack's hosts.
		await release();
		const dynamic = join(volumes(), 'dynamic');
		const own = readFileSync(
			join(dynamic, 'compose-app-production.yml'),
			'utf-8',
		);
		rmSync(join(volumes()), { recursive: true });
		mkdirSync(dynamic, { recursive: true });
		mkdirSync(join(volumes(), 'certs'));
		writeFileSync(join(dynamic, 'other-production.yml'), own);

		const fake = fakeDocker({ registry, exec: edgeOnDisk(volumes()) });
		const error = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v1.4.0' },
			{
				lookup: resolvesHere,
				docker: fake.docker,
				server: fakeServer(fake.calls),
				probe: async () => 200,
				revision: async () => 'abc1234',
				sql: () => ({ query: async () => [] }),
				logins: signedIn,
				migrate: async () => [],
				seed: async () => [],
			},
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(EdgeHostClaimed);
		expect(error).toMatchObject({
			owner: 'other-production',
			project: 'compose-app-production',
		});
		// Refused once the server answered, before anything ran there.
		const ops = fake.ops();
		expect(ops).toContain('ssh');
		for (const op of ['network', 'up', 'build', 'pull', 'push', 'runOnce']) {
			expect(ops).not.toContain(op);
		}
		expect(readdirSync(dynamic)).toEqual(['other-production.yml']);
		expect(readdirSync(join(volumes(), 'certs'))).toEqual([]);

		// Its `--down` frees the host.
		await removeEdgeRoutes(
			fake.docker,
			edgeRef(join(dir, 'gkm-edge.yml')),
			'other-production',
		);
		await release();
		expect(readdirSync(dynamic)).toEqual(['compose-app-production.yml']);
	});

	it('redeploys over its own routes on the edge', async () => {
		await release();
		await release();

		expect(readdirSync(join(volumes(), 'dynamic'))).toEqual([
			'compose-app-production.yml',
		]);
	});

	it('--down stops the stack and unregisters it, leaving the edge and every other stack', async () => {
		await release();
		const dynamic = join(volumes(), 'dynamic');
		writeFileSync(join(dynamic, 'other-production.yml'), 'http: {}\n');

		const { docker, calls } = fakeDocker({ exec: edgeOnDisk(volumes()) });
		await composeCommand(
			{ cwd: dir, stage: 'production', down: true },
			{ lookup: resolvesHere, docker },
		);

		expect(calls.filter((call) => call.op === 'down')).toEqual([
			{
				op: 'down',
				args: 'compose-app-production',
				host: `ssh://deploy@${SERVER_IPV4}`,
			},
		]);
		expect(readdirSync(dynamic)).toEqual(['other-production.yml']);
		expect(readdirSync(join(volumes(), 'certs'))).toEqual([]);
	});
});

/** An `Email` construct the API sends with: the local stage runs Mailpit. */
function withMail(root: string): void {
	writeFileSync(
		join(root, 'constructs', 'mail.ts'),
		`import { Email } from '@geekmidas/constructs/email';

export const mail = new Email('Mail', { templates: {} });
`,
	);
	writeFileSync(
		join(root, 'apps', 'api', 'endpoints', 'notify.ts'),
		`import { api } from '../../../constructs/api.js';
import { mail } from '../../../constructs/mail.js';

export const notify = api
	.post('/notify')
	.dependsOn([mail])
	.handle(async () => ({ ok: true }));
`,
	);
}

describe('the local stage behind the shared edge', () => {
	let dir: string;
	let home: string;
	let workspace: NormalizedWorkspace;
	let manifest: ConstructManifest;
	let background: Record<string, string[]>;

	beforeAll(async () => {
		dir = realpathSync(await createTempDir('gkm-compose-local-traefik-'));
		home = realpathSync(await createTempDir('gkm-compose-local-traefik-home-'));
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			compose: { proxy: { development: 'traefik', production: 'traefik' } },
		});
		withMail(dir);
		({ workspace, manifest, background } = await loadComposeApp(dir));
	});
	afterAll(async () => {
		await cleanupDir(dir);
		await cleanupDir(home);
	});

	function local(
		compose: ComposeWorkspaceConfig | undefined = workspace.deploy?.compose,
	): ComposeStack {
		return composeStack({
			workspace: {
				...workspace,
				deploy: { ...workspace.deploy, compose },
			},
			manifest,
			background,
			stage: 'development',
			identity: deployIdentity(workspace, 'development'),
			images: { mode: 'build', tag: 'abc' },
			secrets: null,
			localCredentials: TEST_CREDENTIALS,
			localAuthority: localAuthorityPaths(home),
			ports: {},
		});
	}

	it("registers with the edge, serving gkm's certificate where a deployed stage's own is served", () => {
		const s = local();

		expect(s.proxy).toBe('traefik');
		expect(s.caddyfile).toBeUndefined();
		expect(s.compose.services.caddy).toBeUndefined();
		expect(s.authority).toEqual(localAuthorityPaths(home));
		expect(s.tls).toBeUndefined();
		const file = parse(s.traefik!);
		expect(file.tls.certificates).toEqual([
			{
				certFile: '/etc/gkm-edge/certs/compose-app-development.crt',
				keyFile: '/etc/gkm-edge/certs/compose-app-development.key',
			},
		]);
		for (const router of Object.values(file.http.routers)) {
			// Its own certificate, never Let's Encrypt, which cannot issue for
			// `*.localhost`.
			expect((router as { tls: unknown }).tls).toEqual({});
		}
	});

	it('routes Mailpit through the edge, and its containers reach the edge on the host', () => {
		const s = local();

		const mail = s.routes.find((route) => route.name === 'mailpit');
		expect(mail?.host).toBe('mail.compose-app.localhost');
		expect(Object.keys(parse(s.traefik!).http.routers)).toContain(
			'compose-app-development-mailpit',
		);
		expect(s.compose.services.mailpit?.networks).toEqual({
			default: { aliases: ['compose-app-development-mailpit'] },
			edge: { aliases: ['compose-app-development-mailpit'] },
		});
		for (const name of ['api', 'auth', 'web', 'jobs']) {
			const service = s.compose.services[name]!;
			// The edge publishes on the host, as the stack's own Caddy did.
			expect(service.extra_hosts, name).toContain(
				'api.compose-app.localhost:host-gateway',
			);
			expect(service.volumes, name).toContain(
				`${localAuthorityPaths(home).certFile}:/etc/gkm/local-ca.pem:ro`,
			);
			expect(service.environment?.NODE_EXTRA_CA_CERTS, name).toBe(
				'/etc/gkm/local-ca.pem',
			);
		}
	});

	it.each([
		['traefik', '/etc/gkm-edge/certs/compose-app-development.crt'],
		['caddy', '/etc/caddy/tls/cert.pem'],
	] as const)('takes the local stage’s own certificate on %s, in place of gkm’s', (proxy, served) => {
		const s = local({
			proxy: { development: proxy },
			tls: {
				development: {
					certFile: 'certs/dev.pem',
					keyFile: 'certs/dev-key.pem',
					caFile: 'certs/root.pem',
				},
			},
		});

		expect(s.proxy).toBe(proxy);
		expect(s.authority).toBeUndefined();
		expect(s.tls).toEqual({
			certFile: join(dir, 'certs/dev.pem'),
			keyFile: join(dir, 'certs/dev-key.pem'),
			caFile: join(dir, 'certs/root.pem'),
		});
		if (proxy === 'traefik') {
			expect(parse(s.traefik!).tls.certificates[0].certFile).toBe(served);
		} else {
			expect(s.caddyfile).toContain(`tls ${served}`);
		}
		// The containers trust the root it names, not gkm's.
		const api = s.compose.services.api!;
		expect(api.volumes).toContain(
			`${join(dir, 'certs/root.pem')}:/etc/gkm/local-ca.pem:ro`,
		);
		expect(api.volumes?.join()).not.toContain(home);
		expect(api.extra_hosts).toContain('api.compose-app.localhost:host-gateway');
	});

	it('hands the containers no root for its own certificate that names none', () => {
		const s = local({
			proxy: { development: 'traefik' },
			tls: {
				development: {
					certFile: 'certs/dev.pem',
					keyFile: 'certs/dev-key.pem',
				},
			},
		});

		const api = s.compose.services.api!;
		expect(api.environment?.NODE_EXTRA_CA_CERTS).toBeUndefined();
		expect(api.volumes?.join() ?? '').not.toContain('/etc/gkm/local-ca.pem');
		expect(api.extra_hosts).toContain('api.compose-app.localhost:host-gateway');
	});

	it('verifies against whichever CA issued the certificate', async () => {
		const authority = localAuthorityPaths(home);
		const root = await ensureLocalAuthority(authority);
		expect(await verifyAuthority({ authority })).toBe(root.cert);

		mkdirSync(join(dir, 'certs'), { recursive: true });
		writeFileSync(join(dir, 'certs', 'root.pem'), 'THEIR ROOT');
		expect(
			await verifyAuthority({
				tls: {
					certFile: join(dir, 'certs/dev.pem'),
					keyFile: join(dir, 'certs/dev-key.pem'),
					caFile: join(dir, 'certs', 'root.pem'),
				},
			}),
		).toBe('THEIR ROOT');
		// A certificate that names no root: Node's own, as a deployed stage's.
		expect(
			await verifyAuthority({
				tls: { certFile: 'a.pem', keyFile: 'a-key.pem' },
			}),
		).toBeUndefined();
	});
});

describe(
	'gkm compose on the local stage with proxy: traefik',
	{ timeout: 60_000 },
	() => {
		let dir: string;
		let home: string;

		beforeEach(async () => {
			vi.spyOn(console, 'log').mockImplementation(() => {});
			dir = realpathSync(await createTempDir('gkm-compose-local-edge-'));
			home = realpathSync(await createTempDir('gkm-compose-local-edge-home-'));
			vi.stubEnv('GKM_HOME', home);
		});
		afterEach(async () => {
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
			await cleanupDir(dir);
			await cleanupDir(home);
		});

		const volumes = () => join(home, 'edge');

		const up = async (compose: Record<string, unknown>) => {
			writeComposeApp(dir, {
				registry: 'registry.example.com/acme',
				compose,
			});
			withMail(dir);
			const fake = fakeDocker({ exec: edgeOnDisk(volumes()) });
			await composeCommand(
				{ cwd: dir, stage: 'development' },
				{
					lookup: resolvesHere,
					docker: fake.docker,
					server: fakeServer([]),
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
			const probes = fake.calls
				.filter((call) => call.op === 'probe')
				.map((call) => call.args as { ca?: string; connectTo?: string });
			return { ...fake, probes };
		};

		const served = () =>
			readFileSync(
				join(volumes(), 'certs', 'compose-app-development.crt'),
				'utf-8',
			);

		it("writes gkm's certificate into the edge, chaining to gkm's root, and verifies against that root", async () => {
			const { calls, probes } = await up({
				proxy: { development: 'traefik', production: 'traefik' },
			});

			// The edge is this machine's: no engine host on any call.
			expect(calls.find((call) => call.op === 'up')).toEqual({
				op: 'up',
				args: ['traefik'],
				edge: true,
			});
			expect(calls.some((call) => call.host)).toBe(false);

			const authority = localAuthorityPaths(home);
			const root = new X509Certificate(
				readFileSync(authority.certFile, 'utf-8'),
			);
			const leaf = new X509Certificate(served());
			expect(leaf.checkIssued(root)).toBe(true);
			expect(leaf.verify(root.publicKey)).toBe(true);
			for (const host of [
				'api.compose-app.localhost',
				'compose-app.localhost',
				'mail.compose-app.localhost',
			]) {
				expect(leaf.checkHost(host), host).toBeDefined();
			}
			expect(
				statSync(join(volumes(), 'certs', 'compose-app-development.key')).mode &
					0o777,
			).toBe(0o600);
			// The same certificate kept beside the stack, so the next run reuses it.
			const stack = join(dir, '.gkm', 'compose', 'development');
			expect(readFileSync(join(stack, 'local-edge.pem'), 'utf-8')).toContain(
				served().trim(),
			);
			expect(existsSync(join(stack, 'Caddyfile'))).toBe(false);
			const routes = parse(
				readFileSync(
					join(volumes(), 'dynamic', 'compose-app-development.yml'),
					'utf-8',
				),
			);
			expect(Object.keys(routes.http.routers)).toContain(
				'compose-app-development-mailpit',
			);

			// Verified on this machine, against gkm's root.
			expect(probes.length).toBeGreaterThan(0);
			for (const probe of probes) {
				expect(probe.connectTo).toBe('127.0.0.1');
				expect(probe.ca).toBe(readFileSync(authority.certFile, 'utf-8'));
			}
			const said = vi
				.mocked(console.log)
				.mock.calls.map((call) => String(call[0]))
				.join('\n');
			expect(said).toContain("Certificates are from gkm's local CA");
		});

		it('serves the local stage’s own certificate instead, and verifies against the root it names', async () => {
			// A certificate from another CA — mkcert's, say — and that CA's root.
			const other = await ensureLocalAuthority(
				localAuthorityPaths(join(dir, 'other-ca')),
			);
			const own = issueLocalCertificate(other, [
				'compose-app.localhost',
				'*.compose-app.localhost',
			]);
			mkdirSync(join(dir, 'certs'), { recursive: true });
			writeFileSync(join(dir, 'certs', 'dev.pem'), own.cert);
			writeFileSync(join(dir, 'certs', 'dev-key.pem'), own.key);
			writeFileSync(join(dir, 'certs', 'root.pem'), other.cert);

			const { probes } = await up({
				proxy: { development: 'traefik' },
				tls: {
					development: {
						certFile: 'certs/dev.pem',
						keyFile: 'certs/dev-key.pem',
						caFile: 'certs/root.pem',
					},
				},
			});

			expect(served()).toBe(own.cert);
			const stack = join(dir, '.gkm', 'compose', 'development');
			expect(existsSync(join(stack, 'local-edge.pem'))).toBe(false);
			expect(probes.length).toBeGreaterThan(0);
			for (const probe of probes) expect(probe.ca).toBe(other.cert);
			const compose = parse(
				readFileSync(join(stack, 'docker-compose.yml'), 'utf-8'),
			);
			expect(compose.services.api.volumes).toContain(
				`${join(dir, 'certs', 'root.pem')}:/etc/gkm/local-ca.pem:ro`,
			);
		});

		it('--down unregisters the local stack from the edge on this machine', async () => {
			await up({ proxy: { development: 'traefik' } });
			const dynamic = join(volumes(), 'dynamic');
			expect(readdirSync(dynamic)).toEqual(['compose-app-development.yml']);

			const { docker, calls } = fakeDocker({ exec: edgeOnDisk(volumes()) });
			await composeCommand(
				{ cwd: dir, stage: 'development', down: true },
				{ lookup: resolvesHere, docker },
			);

			expect(calls.filter((call) => call.op === 'down')).toEqual([
				{ op: 'down', args: 'compose-app-development' },
			]);
			expect(readdirSync(dynamic)).toEqual([]);
			expect(readdirSync(join(volumes(), 'certs'))).toEqual([]);
		});
	},
);
