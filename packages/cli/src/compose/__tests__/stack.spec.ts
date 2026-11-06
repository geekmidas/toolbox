import { realpathSync } from 'node:fs';
import { EnvironmentParser } from '@geekmidas/envkit';
import {
	type ConstructManifest,
	type SiteDeclaration,
	TELEMETRY_KEYS,
} from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { localRolePassword } from '../../reconcile/env';
import { postgresSuperuser } from '../../reconcile/localCredentials';
import { postgresStatements } from '../../reconcile/provision';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import { NoDomainForStage } from '../../target/dokploy/domain';
import { localAuthorityPaths } from '../../trust/authority';
import type { NormalizedWorkspace } from '../../workspace/types';
import { REDIS_IMAGE, RedisPasswordMissing } from '../redis';
import {
	offlineBuildHosts,
	SiteBuildValueUnresolved,
	siteOfflineHosts,
} from '../siteBuild';
import {
	type ComposeStack,
	composeStack,
	EdgeHostTaken,
	envFile,
	LOCAL_CA_IN_CONTAINER,
	LocalCredentialsMissing,
	MailInboxHostTaken,
	NothingToCompose,
	ProcessorOriginSecretMissing,
	PushSubscriptionMissing,
	type StackInput,
	StageSecretMissing,
	StageSeedMissing,
} from '../stack';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let background: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-stack-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	({ workspace, manifest, background } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
});

/** A deployed stage's secrets, as a first run generates them. */
function production(custom: Record<string, string> = {}): StageSecrets {
	return {
		...initStageSecrets('production'),
		seed: 'a-random-seed',
		custom: {
			AUTH_SECRET: 'the-production-signing-secret',
			REDIS_PASSWORD: 'the-redis-password',
			...custom,
		},
	};
}

function stack(overrides: Partial<StackInput> = {}): ComposeStack {
	const stage = overrides.stage ?? 'development';
	return composeStack({
		workspace,
		manifest,
		background,
		stage,
		identity: deployIdentity(workspace, stage),
		images: { mode: 'build', tag: 'abc1234' },
		ports: { https: 8443, http: 8080 },
		localCredentials: TEST_CREDENTIALS,
		...overrides,
	});
}

const LOCAL_REDIS_PASSWORD = TEST_CREDENTIALS.redis.password;

const app = (s: ComposeStack, name: string) =>
	s.apps.find((candidate) => candidate.name === name)!;

describe('the local stage', () => {
	it("runs Postgres with this machine's generated login, as gkm dev does", () => {
		const s = stack();

		expect(s.compose.services.postgres?.environment).toMatchObject({
			POSTGRES_USER: TEST_CREDENTIALS.postgres.user,
			POSTGRES_PASSWORD: TEST_CREDENTIALS.postgres.password,
		});
		expect(s.credential.seed).toBe(TEST_CREDENTIALS.seed);
	});

	it('refuses to compose without the generated logins', () => {
		expect(() => stack({ localCredentials: undefined })).toThrow(
			LocalCredentialsMissing,
		);
	});

	it('never carries the old fixed login', () => {
		const s = stack({ manifest: withServices() });

		const carried = JSON.stringify({
			compose: s.compose,
			env: s.apps.map((a) => a.env),
			redis: s.redis,
			storage: s.storage,
		});
		expect(carried.toLowerCase()).not.toContain('geekmidas');
	});

	it('runs every API and site, the database they need, and one edge', () => {
		const s = stack();

		expect(s.project).toBe('compose-app-development');
		expect(Object.keys(s.compose.services).sort()).toEqual([
			'api',
			'auth',
			'caddy',
			'jobs',
			'postgres',
			'redis',
			'web',
		]);
		expect(s.compose.name).toBe('compose-app-development');
		expect(s.compose.volumes).toHaveProperty('postgres-data');
		expect(s.compose.volumes).toHaveProperty('caddy-data');
	});

	it('starts Caddy once its apps have started, never waiting on their health', () => {
		const { compose, caddyfile } = stack();

		// One app that never turns healthy must not keep the others unrouted,
		// nor a site whose own health check goes through the edge from ever
		// turning healthy.
		expect(compose.services.caddy?.depends_on).toEqual({
			api: { condition: 'service_started' },
			auth: { condition: 'service_started' },
			web: { condition: 'service_started' },
		});
		// Caddy checks each upstream itself instead.
		expect(caddyfile).toContain('health_uri /health');
		expect(caddyfile).toContain('health_uri /\n');
	});

	it('serves each app on its *.localhost host, through the published edge', () => {
		const s = stack();

		expect(app(s, 'api').url).toBe('https://api.compose-app.localhost:8443');
		expect(app(s, 'auth').url).toBe('https://auth.compose-app.localhost:8443');
		// The site the base domain points at answers on the project's bare host.
		expect(app(s, 'web').url).toBe('https://compose-app.localhost:8443');
		expect(s.compose.services.caddy?.ports).toEqual(['8443:443', '8080:80']);
	});

	it("serves the certificate gkm's local CA issues, as a deployed stage serves its own", () => {
		const { caddyfile } = stack();

		expect(caddyfile).not.toContain('local_certs');
		expect(caddyfile).not.toContain('tls internal');
		// Plain HTTP is not sent to 443: the published port may be another.
		expect(caddyfile).toContain('auto_https disable_redirects');
		expect(caddyfile).toContain(`https://api.compose-app.localhost {
	tls /etc/caddy/tls/cert.pem /etc/caddy/tls/key.pem`);
		expect(caddyfile).toContain('reverse_proxy api:3000');
		expect(caddyfile).toContain('reverse_proxy auth:3001');
		expect(caddyfile).toContain('https://compose-app.localhost {');
		// A streamed response reaches the browser as it is written.
		expect(caddyfile.match(/flush_interval -1/g)).toHaveLength(3);
	});

	describe("reaching the stage's own public hosts from a container (#351)", () => {
		const authority = localAuthorityPaths('/home/dev/.gkm');
		const local = () => stack({ localAuthority: authority });
		const runsCode = ['api', 'auth', 'web', 'jobs'];

		it('resolves each public host to the edge, through the host it publishes on', () => {
			const s = local();
			const hosts = s.routes
				.map((route) => route.host)
				.filter((host) => !host.startsWith('*.'));
			expect(hosts).toEqual(
				expect.arrayContaining([
					'api.compose-app.localhost',
					'auth.compose-app.localhost',
					'compose-app.localhost',
				]),
			);

			for (const name of runsCode) {
				expect(s.compose.services[name]?.extra_hosts, name).toEqual(
					[...new Set(hosts)].sort().map((host) => `${host}:host-gateway`),
				);
			}
			// The URL a container is handed carries the edge's published port,
			// which only the host answers on.
			expect(app(s, 'api').url).toBe('https://api.compose-app.localhost:8443');
		});

		it("trusts gkm's root — its public certificate, read-only, never its key", () => {
			const s = local();

			for (const name of runsCode) {
				const service = s.compose.services[name]!;
				expect(service.volumes, name).toContain(
					`/home/dev/.gkm/ca/root.pem:${LOCAL_CA_IN_CONTAINER}:ro`,
				);
				expect(service.environment?.NODE_EXTRA_CA_CERTS, name).toBe(
					LOCAL_CA_IN_CONTAINER,
				);
			}
			expect(JSON.stringify(s.compose)).not.toContain('root-key.pem');
			expect(s.authority).toEqual(authority);
		});

		it('leaves the infrastructure and the edge as they are', () => {
			const s = local();

			for (const name of ['postgres', 'redis', 'caddy']) {
				expect(s.compose.services[name]?.extra_hosts, name).toBeUndefined();
				expect(
					s.compose.services[name]?.environment?.NODE_EXTRA_CA_CERTS,
					name,
				).toBeUndefined();
			}
		});

		it("uses the CLI's home's authority when none is given", () => {
			expect(stack().authority).toEqual(localAuthorityPaths());
		});
	});

	it('builds each image from this checkout, a site per stage', () => {
		const s = stack();

		expect(app(s, 'api').ref).toBe('compose-app/compose-app-api:abc1234');
		expect(app(s, 'web').ref).toBe(
			'compose-app/compose-app-web:abc1234-development',
		);
		expect(s.compose.services.api?.build).toEqual({
			context: '../../..',
			dockerfile: '.gkm/compose/development/Dockerfile.api',
		});
		// Bundled in the image, by the template `gkm docker` writes — never
		// copied in from a bundle built on the host.
		const api = s.dockerfiles['.gkm/compose/development/Dockerfile.api'];
		expect(api).toContain(
			'node "$GKM_BIN" build --provider server --production',
		);
		expect(api).toContain(
			'COPY --from=builder --chown=hono:nodejs /app/apps/api/.gkm/server/dist/server.mjs ./',
		);
		expect(api).not.toMatch(/^COPY apps\//m);
	});
});

describe("every service's Docker logs", () => {
	it('are rotated, whether or not the stack runs a log UI', () => {
		const rotation = {
			driver: 'json-file',
			options: { 'max-size': '10m', 'max-file': '3' },
		};
		const plain = stack({ manifest: withServices() });
		// The API given a Telemetry construct, which runs OpenObserve.
		const withLogs = stack({
			manifest: {
				...manifest,
				Telemetry: {
					kind: 'telemetry',
					id: 'Telemetry',
					provides: [...TELEMETRY_KEYS],
				},
				Api: { ...manifest.Api!, telemetry: 'Telemetry' } as never,
			},
		});

		expect(Object.keys(plain.compose.services).sort()).toEqual([
			'api',
			'auth',
			'caddy',
			'jobs',
			'mailpit',
			'minio',
			'postgres',
			'redis',
			'web',
		]);
		for (const s of [plain, withLogs]) {
			for (const [name, service] of Object.entries(s.compose.services)) {
				expect({ name, logging: service.logging }).toEqual({
					name,
					logging: rotation,
				});
			}
		}
		expect(withLogs.compose.services.openobserve?.logging).toEqual(rotation);
	});
});

describe("a backend's env file", () => {
	it('holds exactly the keys the API reads', () => {
		const env = app(stack(), 'api').env!;

		// Of the auth server it calls, only the address: its CORS list and
		// cookie domain are its own settings, as its secret is. Of the site
		// that calls it, the address it links back to.
		expect(Object.keys(env).sort()).toEqual([
			'API_COOKIE_DOMAIN',
			'API_TRUSTED_ORIGINS',
			'API_URL',
			'AUTH_URL',
			'DATABASE_URL',
			'EVENT_PUBLISHER_CONNECTION_STRING',
			'GKM_EDGE_TOKEN',
			'NODE_ENV',
			'NOTES_PUBLISHER_CONNECTION_STRING',
			'PORT',
			'SESSIONS_URL',
			'STAGE',
			'WEB_URL',
		]);
	});

	it("gives a deployed API each client's identity: a phone app's scheme, the site's address", () => {
		// `MobileApp('App').dependsOn([api])`, and the API redirects an OAuth
		// callback back into it (`<scheme>://…`).
		const withPhone: ConstructManifest = {
			...manifest,
			App: {
				kind: 'mobile-app',
				id: 'App',
				variant: 'expo',
				app: { path: 'apps/app' },
				dependencies: [{ target: 'Api', kind: 'rest-api' }],
				provides: ['APP_SCHEME'],
			},
		};
		const s = stack({
			stage: 'production',
			manifest: withPhone,
			images: { mode: 'pull', tag: 'v1.4.0' },
			secrets: production(),
			ports: {},
		});
		const env = app(s, 'api').env!;

		expect(env.APP_SCHEME).toBe('compose-app');
		expect(env.WEB_URL).toBe('https://shop.example.com');
		// And the auth server, which the phone does not call, gets no scheme.
		expect(app(s, 'auth').env).not.toHaveProperty('APP_SCHEME');
	});

	it('reaches a sibling and names itself by their public addresses', () => {
		const env = app(stack(), 'api').env!;

		// Through the edge, as gkm dev hands it and as it is deployed.
		expect(env.AUTH_URL).toBe('https://auth.compose-app.localhost:8443');
		expect(env.API_URL).toBe('https://api.compose-app.localhost:8443');
		expect(env.PORT).toBe('3000');
		expect(env.STAGE).toBe('development');
		expect(env.NODE_ENV).toBe('production');
	});

	it('gives the auth server its database on the network and its signing secret', () => {
		const env = app(stack(), 'auth').env!;

		expect(env.AUTH_URL).toBe('https://auth.compose-app.localhost:8443');
		expect(env.AUTH_DATABASE_URL).toMatch(
			/^postgres:\/\/authdatabase:[^@]+@postgres:5432\/database$/,
		);
		expect(env.AUTH_SECRET).toBeTruthy();
		// Not the database it does not reach, and never an owner URL.
		expect(env).not.toHaveProperty('DATABASE_URL');
		expect(env).not.toHaveProperty('AUTH_DATABASE_OWNER_URL');
	});

	it('trusts the public origin of every app that calls it, and no other', () => {
		const env = app(stack(), 'auth').env!;

		expect(env.AUTH_TRUSTED_ORIGINS!.split(',')).toEqual([
			'https://api.compose-app.localhost:8443',
			'https://compose-app.localhost:8443',
		]);
	});

	it('scopes the session cookie to the parent of the public hosts', () => {
		expect(app(stack(), 'auth').env!.AUTH_COOKIE_DOMAIN).toBe(
			'.compose-app.localhost',
		);
	});

	it("never carries a construct's secret to an app without the edge", () => {
		const s = stack({
			secrets: {
				...initStageSecrets('development'),
				custom: { AUTH_SECRET: 'set-by-hand' },
			},
		});

		expect(app(s, 'auth').env!.AUTH_SECRET).toBe('set-by-hand');
		expect(app(s, 'api').env).not.toHaveProperty('AUTH_SECRET');
	});

	it("hands every app the stage's own secrets, as gkm dev does", () => {
		const s = stack({
			secrets: {
				...initStageSecrets('development'),
				custom: { STRIPE_KEY: 'sk_test_x', GKM_SERVER_IPV4: '203.0.113.7' },
			},
		});

		// Read with get('STRIPE_KEY'), which no construct declares a reader of.
		for (const name of ['api', 'auth']) {
			expect(app(s, name).env!.STRIPE_KEY).toBe('sk_test_x');
			// gkm's own key for the stack is no app's.
			expect(app(s, name).env).not.toHaveProperty('GKM_SERVER_IPV4');
		}
		expect(s.workers.find((w) => w.name === 'jobs')!.env!.STRIPE_KEY).toBe(
			'sk_test_x',
		);
		// A static site is a bundle: nothing at runtime.
		expect(app(s, 'web').env).toBeUndefined();
	});

	it('renders one KEY=value line per key, sorted', () => {
		expect(envFile({ B: '2', A: 'x=y' })).toBe('A=x=y\nB=2\n');
	});

	it('is read raw by compose, so nothing in a value is interpolated', () => {
		expect(stack().compose.services.api?.env_file).toEqual([
			{ path: './api.env', format: 'raw' },
		]);
	});
});

describe('a static site', () => {
	const dockerfileOf = (s: ComposeStack) =>
		s.dockerfiles[`.gkm/compose/${s.stage}/Dockerfile.web`]!;

	it('is built with its public URLs and its own address as build args', () => {
		const s = stack();

		expect(s.compose.services.web?.build?.args).toEqual({
			// Its own address under its own name — read by server code at build
			// time — and under the public prefix, for the bundle.
			WEB_URL: 'https://compose-app.localhost:8443',
			VITE_WEB_URL: 'https://compose-app.localhost:8443',
			VITE_API_URL: 'https://api.compose-app.localhost:8443',
			VITE_AUTH_URL: 'https://auth.compose-app.localhost:8443',
		});
		// Every one declared, or the build drops it.
		for (const key of Object.keys(s.compose.services.web!.build!.args!)) {
			expect(dockerfileOf(s)).toContain(`ARG ${key}=""`);
			expect(dockerfileOf(s)).toContain(`ENV ${key}=$${key}`);
		}
	});

	it('gets its own address with no edges at all', () => {
		const alone = {
			...manifest,
			Web: { ...manifest.Web, dependencies: [] },
		} as ConstructManifest;
		const s = stack({ manifest: alone });

		expect(s.compose.services.web?.build?.args).toEqual({
			WEB_URL: 'https://compose-app.localhost:8443',
			VITE_WEB_URL: 'https://compose-app.localhost:8443',
		});
		expect(dockerfileOf(s)).toContain('ARG WEB_URL=""');
	});

	it('is built with the stage secrets named for the bundle, and no others', () => {
		const s = stack({
			stage: 'production',
			images: {
				mode: 'build',
				tag: 'v1',
				registry: 'registry.example.com/acme',
			},
			secrets: production({
				VITE_APP_STORE_URL: 'https://apps.apple.com/app/id1',
				// Another variant's prefix: not this site's bundle.
				NEXT_PUBLIC_ANALYTICS_ID: 'G-123',
				STRIPE_KEY: 'sk_live_x',
			}),
			ports: {},
		});
		const args = s.compose.services.web!.build!.args!;

		expect(args.VITE_APP_STORE_URL).toBe('https://apps.apple.com/app/id1');
		expect(dockerfileOf(s)).toContain('ARG VITE_APP_STORE_URL=""');
		expect(args).not.toHaveProperty('NEXT_PUBLIC_ANALYTICS_ID');
		expect(args).not.toHaveProperty('STRIPE_KEY');
		expect(args).not.toHaveProperty('AUTH_SECRET');
		expect(dockerfileOf(s)).not.toContain('STRIPE_KEY');
	});

	it('builds a site whose config needs its own address at build time', () => {
		// The environment `next build` runs in inside the image: the
		// Dockerfile's `ENV KEY=$KEY` lines, each filled from the build arg
		// compose passes. A key the Dockerfile does not declare is not there.
		const s = stack();
		const args = s.compose.services.web!.build!.args!;
		const buildEnv: Record<string, string | undefined> = {};
		for (const [, key] of dockerfileOf(s).matchAll(/^ENV (\w+)=\$\1$/gm)) {
			buildEnv[key!] = args[key!];
		}

		// A site's server config, as one reads its own URL for `metadataBase`
		// while it prerenders — what failed with
		// `Environment variable "WEB_URL": expected string, received undefined`.
		const config = new EnvironmentParser(buildEnv)
			.create((get) => ({
				webUrl: get('WEB_URL').string().url(),
				publicWebUrl: get('VITE_WEB_URL').string().url(),
			}))
			.parse();

		expect(config).toEqual({
			webUrl: 'https://compose-app.localhost:8443',
			publicWebUrl: 'https://compose-app.localhost:8443',
		});
	});

	it('is built with its own host and its edges refused, and their real URLs inlined', () => {
		const s = stack();
		const build = s.compose.services.web!.build!;

		// Nothing in the build container listens on loopback, so a fetch to one
		// of them is refused at once rather than waiting on a stack not up yet.
		expect(build.extra_hosts).toEqual([
			'api.compose-app.localhost:127.0.0.1',
			'auth.compose-app.localhost:127.0.0.1',
			'compose-app.localhost:127.0.0.1',
		]);
		// The mapping is the build's own: what the bundle inlines is unchanged.
		expect(build.args!.VITE_API_URL).toBe(
			'https://api.compose-app.localhost:8443',
		);
		// And a backend's build reaches whatever it reaches.
		expect(s.compose.services.api?.build?.extra_hosts).toBeUndefined();
	});

	describe("pre-rendered against its stage (prerender: 'stage')", () => {
		const prerendered = (): ConstructManifest => ({
			...manifest,
			Web: { ...(manifest.Web as SiteDeclaration), prerender: 'stage' },
		});
		const authority = localAuthorityPaths('/home/dev/.gkm');

		it('waits on the apps its edges name, and Caddy does not wait on it', () => {
			const s = stack({ manifest: prerendered() });

			expect(app(s, 'web').prerender).toEqual({ against: ['api', 'auth'] });
			expect(app(s, 'api').prerender).toBeUndefined();
			// Started before it is built: Caddy routes to it once it is up.
			expect(s.compose.services.caddy?.depends_on).toEqual({
				api: { condition: 'service_started' },
				auth: { condition: 'service_started' },
			});
			expect(stack().compose.services.caddy?.depends_on).toHaveProperty('web');
		});

		it("reaches the local stage's hosts through the edge, trusting gkm's root, and is never told it is offline", () => {
			const s = stack({
				manifest: prerendered(),
				localAuthority: authority,
				prerenderRun: '2026-11-02T12:00:00.000Z',
			});
			const build = s.compose.services.web!.build!;

			// Its hosts point at the edge rather than at a refusing address.
			expect(build.extra_hosts).toEqual([
				'api.compose-app.localhost:host-gateway',
				'auth.compose-app.localhost:host-gateway',
				'compose-app.localhost:host-gateway',
			]);
			expect(build.secrets).toEqual(['gkm_local_ca']);
			expect(s.compose.secrets).toEqual({
				gkm_local_ca: { file: '/home/dev/.gkm/ca/root.pem' },
			});
			// Its real URLs, and the run that keys its build.
			expect(build.args).toMatchObject({
				VITE_API_URL: 'https://api.compose-app.localhost:8443',
				GKM_PRERENDER_RUN: '2026-11-02T12:00:00.000Z',
			});
			const dockerfile = dockerfileOf(s);
			expect(dockerfile).not.toContain('GKM_BUILD_OFFLINE');
			// Declared once, by the build step that reads it — never inlined.
			expect(dockerfile.match(/ARG GKM_PRERENDER_RUN=/g)).toHaveLength(1);
			expect(dockerfile).not.toContain('ENV GKM_PRERENDER_RUN');
		});

		it('reaches a deployed stage at its public hosts, as anything else does', () => {
			const s = stack({
				manifest: prerendered(),
				stage: 'production',
				images: {
					mode: 'build',
					tag: 'v1',
					registry: 'registry.example.com/acme',
				},
				secrets: production(),
				ports: {},
			});
			const build = s.compose.services.web!.build!;

			expect(build.extra_hosts).toBeUndefined();
			expect(build.secrets).toBeUndefined();
			expect(s.compose.secrets).toBeUndefined();
			expect(build.args!.VITE_API_URL).toBe('https://api.shop.example.com');
			expect(
				siteOfflineHosts(prerendered(), 'web', 'https://shop.example.com', {
					api: 'https://api.shop.example.com',
				}),
			).toEqual([]);
		});

		it('is pulled as it was pushed, with nothing held back', () => {
			const s = stack({
				manifest: prerendered(),
				images: {
					mode: 'pull',
					tag: 'v1',
					registry: 'registry.example.com/acme',
				},
			});

			expect(s.compose.services.web?.build).toBeUndefined();
			expect(s.compose.services.caddy?.depends_on).toHaveProperty('web');
		});
	});

	it("leaves another service's host alone in its build", () => {
		const s = stack({
			stage: 'production',
			images: {
				mode: 'build',
				tag: 'v1',
				registry: 'registry.example.com/acme',
			},
			secrets: production({
				VITE_APP_STORE_URL: 'https://apps.apple.com/app/id1',
			}),
			ports: {},
		});
		const build = s.compose.services.web!.build!;

		expect(build.args!.VITE_APP_STORE_URL).toBe(
			'https://apps.apple.com/app/id1',
		);
		expect(build.extra_hosts).not.toContainEqual(
			expect.stringContaining('apps.apple.com'),
		);
		expect(build.extra_hosts).toEqual([
			'api.shop.example.com:127.0.0.1',
			'auth.shop.example.com:127.0.0.1',
			'shop.example.com:127.0.0.1',
		]);
	});

	it('maps only names in its build: never localhost, an address or a wildcard', () => {
		const site = manifest.Web as SiteDeclaration;
		const values: Record<string, string> = {
			WEB_URL: 'https://*.example.com',
			API_URL: 'http://localhost:3000',
			AUTH_URL: 'http://10.0.0.5:3001',
		};

		expect(offlineBuildHosts(site, manifest, (key) => values[key])).toEqual([]);
		values.API_URL = 'https://api.example.com';
		expect(offlineBuildHosts(site, manifest, (key) => values[key])).toEqual([
			'api.example.com',
		]);
	});

	it('refuses the same hosts on a target that knows URLs by app', () => {
		const s = stack({
			stage: 'production',
			images: {
				mode: 'build',
				tag: 'v1',
				registry: 'registry.example.com/acme',
			},
			secrets: production(),
			ports: {},
		});

		// One rule: what `docker build --add-host` gets is what compose's
		// `build.extra_hosts` gets.
		expect(
			siteOfflineHosts(manifest, 'web', 'https://shop.example.com', {
				api: 'https://api.shop.example.com',
				auth: 'https://auth.shop.example.com',
			}).map((host) => `${host}:127.0.0.1`),
		).toEqual(s.compose.services.web!.build!.extra_hosts);
		expect(
			siteOfflineHosts(manifest, 'api', 'https://x.example.com', {}),
		).toEqual([]);
	});

	it('keeps its own address over a stage secret of the same name', () => {
		const s = stack({
			secrets: {
				...initStageSecrets('development'),
				custom: { VITE_WEB_URL: 'https://stale.example.com' },
			},
		});

		expect(s.compose.services.web!.build!.args!.VITE_WEB_URL).toBe(
			'https://compose-app.localhost:8443',
		);
	});

	it('gets no server env and waits on no infrastructure', () => {
		const web = stack().compose.services.web!;

		expect(web.env_file).toBeUndefined();
		// Only what lets its server-side code reach the stage's own hosts.
		expect(web.environment).toEqual({
			NODE_EXTRA_CA_CERTS: LOCAL_CA_IN_CONTAINER,
		});
		expect(web.depends_on).toBeUndefined();
		expect(app(stack(), 'web').env).toBeUndefined();
	});
});

describe('a deployed stage', () => {
	const deployed = (overrides: Partial<StackInput> = {}) =>
		stack({
			stage: 'production',
			images: {
				mode: 'pull',
				tag: 'v1.4.0',
				registry: 'registry.example.com/acme',
			},
			secrets: production(),
			ports: {},
			...overrides,
		});

	it("never writes the server's address into an app's or a worker's env", () => {
		const s = deployed({
			secrets: production({
				GKM_SERVER_IPV4: '203.0.113.10',
				GKM_SERVER_IPV6: '2001:db8::10',
			}),
		});

		const envs = JSON.stringify([
			...s.apps.map((a) => a.env),
			...s.workers.map((w) => w.env),
		]);
		expect(envs).not.toContain('GKM_SERVER_');
		expect(envs).not.toContain('203.0.113.10');
	});

	it('points no container at the edge and mounts no local root: its hosts are public', () => {
		const s = deployed();

		expect(s.authority).toBeUndefined();
		for (const service of Object.values(s.compose.services)) {
			expect(service.extra_hosts).toBeUndefined();
			expect(service.environment?.NODE_EXTRA_CA_CERTS).toBeUndefined();
			expect(JSON.stringify(service.volumes ?? [])).not.toContain(
				LOCAL_CA_IN_CONTAINER,
			);
		}
	});

	it("answers on the stage's domains, with certificates from ACME", () => {
		const s = deployed();

		expect(app(s, 'api').url).toBe('https://api.shop.example.com');
		expect(app(s, 'web').url).toBe('https://shop.example.com');
		expect(s.caddyfile).not.toMatch(/^\s*tls /m);
		expect(s.caddyfile).not.toContain('auto_https');
		expect(s.caddyfile).toContain('https://api.shop.example.com {');
		expect(s.compose.services.caddy?.ports).toEqual(['443:443', '80:80']);
	});

	it('pulls the tag, and a site at <tag>-<stage>, building nothing', () => {
		const s = deployed();

		expect(app(s, 'api').ref).toBe(
			'registry.example.com/acme/compose-app/compose-app-api:v1.4.0',
		);
		expect(app(s, 'web').ref).toBe(
			'registry.example.com/acme/compose-app/compose-app-web:v1.4.0-production',
		);
		for (const service of Object.values(s.compose.services)) {
			expect(service.build).toBeUndefined();
		}
		expect(s.dockerfiles).toEqual({});
	});

	it("reads the signing secret from the stage's secrets, never a derivation", () => {
		expect(app(deployed(), 'auth').env!.AUTH_SECRET).toBe(
			'the-production-signing-secret',
		);
	});

	it("derives its database passwords from the stage's seed", () => {
		const s = deployed();
		const url = new URL(app(s, 'auth').env!.AUTH_DATABASE_URL!);

		expect(url.username).toBe('authdatabase_production');
		expect(url.password).toBe(
			localRolePassword(
				'compose-app',
				s.plan,
				'authdatabase_production',
				'a-random-seed',
			),
		);
		expect(s.compose.services.postgres?.environment).toMatchObject({
			POSTGRES_USER: postgresSuperuser('compose-app'),
			POSTGRES_PASSWORD: localRolePassword(
				'compose-app',
				s.plan,
				'master',
				'a-random-seed',
			),
		});
	});

	it('refuses a stage whose secrets have no seed', () => {
		expect(() =>
			deployed({ secrets: { ...production(), seed: undefined } }),
		).toThrow(StageSeedMissing);
	});

	it('refuses a secret the stage was never given, naming the key', () => {
		const run = () =>
			deployed({
				secrets: {
					...production(),
					custom: { REDIS_PASSWORD: 'the-redis-password' },
				},
			});

		expect(run).toThrow(StageSecretMissing);
		expect(run).toThrow(/AUTH_SECRET/);
	});
});

/**
 * The workspace with mail and a bucket: the API sends mail and writes to the
 * bucket, and the site links to the bucket's file server.
 */
function withServices(): ConstructManifest {
	const web = manifest.Web as unknown as {
		dependencies: { target: string; kind: string }[];
	};
	return {
		...manifest,
		Uploads: {
			kind: 'objects',
			id: 'Uploads',
			provides: ['UPLOADS_CONNECTION_STRING'],
		},
		UploadsServer: {
			kind: 'file-server',
			id: 'UploadsServer',
			of: 'Uploads',
			open: ['brand/**'],
			provides: ['UPLOADS_URL'],
		},
		Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
		Api: {
			...manifest.Api,
			endpoints: [
				{
					id: 'Upload',
					handler: 'upload.handler',
					method: 'POST',
					path: '/upload',
					dependencies: [
						{ target: 'Uploads', kind: 'objects' },
						{ target: 'Mail', kind: 'email' },
					],
				},
			],
		},
		Web: {
			...manifest.Web,
			dependencies: [
				...web.dependencies,
				{ target: 'UploadsServer', kind: 'file-server' },
			],
		},
	} as unknown as ConstructManifest;
}

/** What a stage that brings its own mail server and bucket sets. */
const EXTERNAL = {
	MAIL_URL: 'smtp://user:password@smtp.example.com:587',
	MAIL_FROM: 'noreply@shop.example.com',
	UPLOADS_CONNECTION_STRING: 's3://acme-uploads?region=eu-west-1',
	AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
	AWS_SECRET_ACCESS_KEY: 'external-secret',
	UPLOADS_URL: 'https://files.shop.example.com',
};

describe('mail and storage on the local stage', () => {
	it('runs MinIO and Mailpit with no secret, and creates the bucket', () => {
		const s = stack({ manifest: withServices() });
		const api = app(s, 'api').env!;

		expect(s.infra).toEqual(['mailpit', 'minio', 'postgres', 'redis']);
		expect(api.UPLOADS_CONNECTION_STRING).toBe(
			's3://uploads?region=us-east-1&endpoint=http://minio:9000&forcePathStyle=true',
		);
		// This machine's generated login: the one `gkm dev`'s MinIO runs with.
		expect(api.AWS_ACCESS_KEY_ID).toBe(TEST_CREDENTIALS.minio.user);
		expect(api.AWS_SECRET_ACCESS_KEY).toBe(TEST_CREDENTIALS.minio.password);
		expect(s.compose.services.minio?.environment).toMatchObject({
			MINIO_ROOT_USER: TEST_CREDENTIALS.minio.user,
			MINIO_ROOT_PASSWORD: TEST_CREDENTIALS.minio.password,
		});
		expect(api.MAIL_URL).toBe('smtp://mailpit:1025');
		expect(s.storage).toMatchObject({
			buckets: ['uploads'],
			policies: [{ bucket: 'uploads', open: ['brand/**'] }],
		});
		// Published on loopback only, for the buckets to be created from here.
		expect(s.compose.services.minio?.ports).toEqual(['127.0.0.1::9000']);
		expect(s.devServices).toEqual([]);
	});

	it("serves Mailpit's inbox on the edge, at mail.<project>.localhost", () => {
		const s = stack({ manifest: withServices() });

		expect(s.mailInbox).toEqual({
			host: 'mail.compose-app.localhost',
			url: 'https://mail.compose-app.localhost:8443',
		});
		// In the route list both proxies render from, not Caddy's alone.
		expect(s.routes).toContainEqual({
			name: 'mailpit',
			host: 'mail.compose-app.localhost',
			upstreams: [{ service: 'mailpit', port: 8025 }],
			streaming: true,
		});
		expect(s.caddyfile).toContain('https://mail.compose-app.localhost {');
		expect(s.caddyfile).toContain('reverse_proxy mailpit:8025');
		// Reached through the edge, never on a published port.
		expect(s.compose.services.mailpit?.ports).toBeUndefined();
	});

	it('has no inbox to route where nothing sends mail', () => {
		const s = stack();

		expect(s.infra).not.toContain('mailpit');
		expect(s.mailInbox).toBeUndefined();
		expect(s.routes.map((route) => route.name)).not.toContain('mailpit');
	});

	it("refuses an app on the inbox's host, naming the app", () => {
		const manifest = withServices();
		const run = () =>
			stack({
				manifest: {
					...manifest,
					Api: { ...manifest.Api, subdomain: 'mail' },
				} as unknown as ConstructManifest,
			});

		expect(run).toThrow(MailInboxHostTaken);
		expect(run).toThrow(/'api' answers on mail\.compose-app\.localhost/);
	});

	it("serves the file server on the edge, at gkm dev's host for it", () => {
		const s = stack({ manifest: withServices() });

		expect(app(s, 'web').build?.args?.VITE_UPLOADS_URL).toBe(
			'https://uploads.compose-app.localhost:8443',
		);
		expect(s.caddyfile).toContain('https://uploads.compose-app.localhost {');
		expect(s.caddyfile).toContain('reverse_proxy minio:9000');
		expect(s.caddyfile).toContain('rewrite /uploads{uri}');
	});
});

describe('mail and storage on a deployed stage', () => {
	const deployed = (overrides: Partial<StackInput> = {}) =>
		stack({
			stage: 'production',
			manifest: withServices(),
			images: { mode: 'pull', tag: 'v1.4.0' },
			secrets: production(),
			ports: {},
			...overrides,
		});

	it('hands no inbox to a site or a phone: Mailpit runs only locally', () => {
		// A mobile app that opens sign-in links, as a site might.
		const manifest: ConstructManifest = {
			...withServices(),
			App: {
				kind: 'mobile-app',
				id: 'App',
				variant: 'expo',
				app: { path: 'apps/app' },
				dependencies: [
					{ target: 'Api', kind: 'rest-api' },
					{ target: 'Mail', kind: 'email' },
				],
				provides: ['APP_SCHEME'],
			},
		};
		const phone = (s: ComposeStack) =>
			s.mobileApps.find((candidate) => candidate.name === 'app')!.values;

		// Deployed: the public API, the scheme — and no inbox, even where the
		// stage runs Mailpit as a dev service.
		const prod = deployed({ manifest, allowDevServices: true });
		expect(phone(prod)).toEqual({
			APP_SCHEME: 'compose-app',
			EXPO_PUBLIC_API_URL: 'https://api.shop.example.com',
		});
		expect(Object.keys(app(prod, 'web').build?.args ?? {})).not.toContain(
			'VITE_MAIL_INBOX_URL',
		);

		// Locally the inbox is how a sign-in link is opened.
		expect(phone(stack({ manifest }))).toHaveProperty(
			'EXPO_PUBLIC_MAIL_INBOX_URL',
		);
	});

	it('decides, and refuses nothing: a stage missing every key runs neither', () => {
		// Whether the stage lacks a key is the deploy's readiness check's to
		// say, once — a build composes this stack with none of them.
		const s = deployed();

		expect(s.infra).toEqual(['postgres', 'redis']);
		expect(s.compose.services).not.toHaveProperty('minio');
		expect(s.compose.services).not.toHaveProperty('mailpit');
		expect(s.devServices).toEqual([]);
	});

	it("runs neither where the stage's secrets configure both", () => {
		const s = deployed({ secrets: production(EXTERNAL) });
		const api = app(s, 'api').env!;

		expect(s.infra).toEqual(['postgres', 'redis']);
		expect(s.compose.services).not.toHaveProperty('minio');
		expect(s.compose.services).not.toHaveProperty('mailpit');
		expect(api.MAIL_URL).toBe(EXTERNAL.MAIL_URL);
		expect(api.MAIL_FROM).toBe(EXTERNAL.MAIL_FROM);
		expect(api.UPLOADS_CONNECTION_STRING).toBe(
			EXTERNAL.UPLOADS_CONNECTION_STRING,
		);
		expect(api.AWS_ACCESS_KEY_ID).toBe(EXTERNAL.AWS_ACCESS_KEY_ID);
		expect(api.AWS_SECRET_ACCESS_KEY).toBe(EXTERNAL.AWS_SECRET_ACCESS_KEY);
		expect(app(s, 'web').build).toBeUndefined();
		expect(s.caddyfile).not.toContain('minio');
		expect(s.devServices).toEqual([]);
	});

	it("signs with the bucket URL's own key, and hands the app no shared pair", () => {
		const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ...rest } = EXTERNAL;
		const UPLOADS_CONNECTION_STRING =
			's3://AKIAUPLOADS:a%2Fsecret%2Bvalue@acme-uploads?region=eu-west-1';
		const s = deployed({
			secrets: production({ ...rest, UPLOADS_CONNECTION_STRING }),
		});
		const api = app(s, 'api').env!;

		expect(s.infra).toEqual(['postgres', 'redis']);
		expect(api.UPLOADS_CONNECTION_STRING).toBe(UPLOADS_CONNECTION_STRING);
		expect(api).not.toHaveProperty('AWS_ACCESS_KEY_ID');
		expect(api).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
	});

	it('deploys a bucket with no credentials at all, for a role to sign', () => {
		const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ...rest } = EXTERNAL;
		const s = deployed({ secrets: production(rest) });
		const api = app(s, 'api').env!;

		expect(api.UPLOADS_CONNECTION_STRING).toBe(
			EXTERNAL.UPLOADS_CONNECTION_STRING,
		);
		expect(api).not.toHaveProperty('AWS_ACCESS_KEY_ID');
		expect(api).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
	});

	it("sends Mailpit's mail as the construct's local part at the stage's domain", () => {
		const manifest = withServices();
		const s = deployed({
			allowDevServices: true,
			manifest: {
				...manifest,
				Mail: { ...manifest.Mail, from: 'info' },
			} as ConstructManifest,
		});

		expect(app(s, 'api').env!.MAIL_FROM).toBe('info@shop.example.com');
	});

	it('runs MinIO and Mailpit where allowed, with keys derived from them', () => {
		const s = deployed({ allowDevServices: true });
		const api = app(s, 'api').env!;
		const password = localRolePassword(
			'compose-app',
			s.plan,
			'minio',
			'a-random-seed',
		);

		expect(s.infra).toEqual(['mailpit', 'minio', 'postgres', 'redis']);
		expect(s.compose.services.minio?.environment).toMatchObject({
			MINIO_ROOT_USER: 'compose-app-minio',
			MINIO_ROOT_PASSWORD: password,
		});
		expect(api.UPLOADS_CONNECTION_STRING).toBe(
			's3://uploads-production?region=us-east-1&endpoint=http://minio:9000&forcePathStyle=true',
		);
		expect(api.AWS_ACCESS_KEY_ID).toBe('compose-app-minio');
		expect(api.AWS_SECRET_ACCESS_KEY).toBe(password);
		expect(api.MAIL_URL).toBe('smtp://mailpit:1025');
		expect(api.MAIL_FROM).toBe('noreply@shop.example.com');
		// Mailpit's inbox is not a deployed stage's to hand out.
		expect(api).not.toHaveProperty('MAIL_INBOX_URL');
		// Nor its web UI: no route, no published port.
		expect(s.mailInbox).toBeUndefined();
		expect(s.routes.map((route) => route.name)).not.toContain('mailpit');
		expect(s.caddyfile).not.toContain('mailpit:8025');
		expect(s.compose.services.mailpit?.ports).toBeUndefined();
		expect(s.storage?.buckets).toEqual(['uploads-production']);
		expect(s.caddyfile).toContain('https://uploads.shop.example.com {');
		expect(s.devServices).toEqual([
			{ service: 'mailpit', ids: ['Mail'] },
			{ service: 'minio', ids: ['Uploads'] },
		]);
	});

	it('keeps every key the stage did set over the dev service', () => {
		const s = deployed({
			allowDevServices: true,
			secrets: production({
				MAIL_URL: EXTERNAL.MAIL_URL,
				MAIL_FROM: EXTERNAL.MAIL_FROM,
				AWS_ACCESS_KEY_ID: 'stage-key',
				AWS_SECRET_ACCESS_KEY: 'stage-secret-value',
				UPLOADS_URL: EXTERNAL.UPLOADS_URL,
			}),
		});
		const api = app(s, 'api').env!;

		// Mail is the stage's own, so no Mailpit runs.
		expect(s.infra).toEqual(['minio', 'postgres', 'redis']);
		expect(api.MAIL_URL).toBe(EXTERNAL.MAIL_URL);
		expect(api.MAIL_FROM).toBe(EXTERNAL.MAIL_FROM);
		// The bucket is MinIO's, signed with the key pair the stage chose.
		expect(api.AWS_ACCESS_KEY_ID).toBe('stage-key');
		expect(s.compose.services.minio?.environment).toMatchObject({
			MINIO_ROOT_USER: 'stage-key',
			MINIO_ROOT_PASSWORD: 'stage-secret-value',
		});
		expect(app(s, 'web').build).toBeUndefined();
		expect(s.caddyfile).not.toContain('https://uploads.');
		expect(s.devServices).toEqual([{ service: 'minio', ids: ['Uploads'] }]);
		// The file server's address set by hand is kept, and said to differ
		// from the one the stage's domain gives.
		expect(api.UPLOADS_URL).toBe(EXTERNAL.UPLOADS_URL);
		expect(s.warnings).toEqual([
			expect.stringMatching(
				/UPLOADS_URL is set by hand to https:\/\/files\.shop\.example\.com, and kept[\s\S]*https:\/\/uploads\.shop\.example\.com/,
			),
		]);
	});

	describe("with a provider backing the stage's buckets", () => {
		const withS3 = (config: { cdn?: boolean } = {}) => ({
			...workspace,
			deploy: {
				...workspace.deploy,
				objects: { production: { provider: 's3' as const, ...config } },
			},
		});

		it('runs no MinIO under --allow-dev-services: the provider accounts for buckets', () => {
			// Before the deploy has written the bucket's keys: decided, not refused.
			const s = deployed({ workspace: withS3(), allowDevServices: true });

			expect(s.infra).toEqual(['mailpit', 'postgres', 'redis']);
			expect(s.devServices).toEqual([{ service: 'mailpit', ids: ['Mail'] }]);
		});

		const STORED = {
			UPLOADS_CONNECTION_STRING:
				's3://AKIAUPLOADS:secret@compose-app-production-uploads?region=eu-west-1',
			// What the provider wrote: its CDN, on the stage's domain.
			UPLOADS_URL: 'https://uploads.shop.example.com',
		};
		const built = (
			secrets: Record<string, string>,
			config: { cdn?: boolean } = {},
		) =>
			deployed({
				workspace: withS3(config),
				allowDevServices: true,
				images: { mode: 'build', tag: 'abc1234' },
				secrets: production(secrets),
			});

		it("builds a site with each bucket's signed origin from its stored connection, never MinIO's", () => {
			const s = built(STORED);
			const args = app(s, 'web').build!.args!;

			expect(args.VITE_UPLOADS_SIGNED_ORIGIN).toBe(
				'https://compose-app-production-uploads.s3.eu-west-1.amazonaws.com',
			);
			expect(args.VITE_GKM_IMAGE_ORIGINS).toBe(
				'https://compose-app-production-uploads.s3.eu-west-1.amazonaws.com,https://uploads.shop.example.com',
			);
			expect(JSON.stringify(args)).not.toContain('minio');
			expect(s.warnings).toEqual([]);
		});

		it("builds a site with its file server on the stage's domain after the domain changed", () => {
			// The deploy that rewrites the stored copy runs after this build.
			const s = built({
				...STORED,
				UPLOADS_URL: 'https://uploads.old-shop.example.com',
			});
			const args = app(s, 'web').build!.args!;

			expect(args.VITE_UPLOADS_URL).toBe('https://uploads.shop.example.com');
			expect(args.VITE_GKM_IMAGE_ORIGINS).toBe(
				'https://compose-app-production-uploads.s3.eu-west-1.amazonaws.com,https://uploads.shop.example.com',
			);
			expect(JSON.stringify(args)).not.toContain('old-shop');
			// The API it calls links to the same host its pages allow.
			expect(app(s, 'api').env!.UPLOADS_URL).toBe(
				'https://uploads.shop.example.com',
			);
			expect(s.warnings).toEqual([
				expect.stringMatching(
					/UPLOADS_URL is stored as https:\/\/uploads\.old-shop\.example\.com[\s\S]*https:\/\/uploads\.shop\.example\.com/,
				),
			]);
		});

		it("keeps the bucket's own endpoint where the stage serves it without a CDN", () => {
			const endpoint =
				'https://compose-app-production-uploads.s3.eu-west-1.amazonaws.com';
			const s = built({ ...STORED, UPLOADS_URL: endpoint }, { cdn: false });

			expect(app(s, 'web').build!.args!.VITE_UPLOADS_URL).toBe(endpoint);
			expect(s.warnings).toEqual([]);
		});

		it('refuses to build a site before the deploy wrote where it loads files from', () => {
			// A CI image build ahead of the stage's first deploy: behind a CDN the
			// file server's address is the stage's domain's, the signed origin
			// still needs the bucket's connection.
			expect(() => built({})).toThrow(SiteBuildValueUnresolved);
			expect(() => built({})).toThrow(
				/UPLOADS_SIGNED_ORIGIN[\s\S]*no UPLOADS_CONNECTION_STRING[\s\S]*gkm deploy --stage production/,
			);
			// On the bucket's own endpoint, only the deploy knows the address.
			const { UPLOADS_URL, ...connectionOnly } = STORED;
			expect(() => built(connectionOnly, { cdn: false })).toThrow(
				/'Web' inlines UPLOADS_URL[\s\S]*gkm deploy --stage production/,
			);
		});

		it('deploys with the keys the provider wrote, and runs mail on Mailpit', () => {
			const s = deployed({
				workspace: withS3(),
				allowDevServices: true,
				secrets: production({
					UPLOADS_CONNECTION_STRING:
						's3://AKIAUPLOADS:secret@compose-app-production-uploads?region=eu-west-1',
					UPLOADS_URL:
						'https://compose-app-production-uploads.s3.eu-west-1.amazonaws.com',
				}),
			});

			expect(s.infra).toEqual(['mailpit', 'postgres', 'redis']);
			expect(s.devServices).toEqual([{ service: 'mailpit', ids: ['Mail'] }]);
		});
	});
});

describe('a worker', () => {
	const worker = (s: ComposeStack) =>
		s.workers.find((candidate) => candidate.name === 'jobs')!;

	it('is a service with no route and no published port, restarted and health-checked', () => {
		const s = stack();
		const service = s.compose.services.jobs!;

		expect(worker(s)).toMatchObject({ id: 'Jobs', host: 'api', port: 3000 });
		expect(service.ports).toBeUndefined();
		expect(service.restart).toBe('unless-stopped');
		expect(service.env_file).toEqual([{ path: './jobs.env', format: 'raw' }]);
		expect(service.depends_on).toEqual({
			postgres: { condition: 'service_healthy' },
			redis: { condition: 'service_healthy' },
		});
		expect(service.healthcheck?.test).toEqual([
			'CMD',
			'wget',
			'-q',
			'-O',
			'/dev/null',
			'http://127.0.0.1:3000/health',
		]);
		expect(service.logging?.driver).toBe('json-file');
		// Nothing routes to it, and the edge does not wait for it.
		expect(s.caddyfile).not.toContain('jobs');
		expect(s.compose.services.caddy?.depends_on).not.toHaveProperty('jobs');
		expect(s.apps.map((a) => a.name)).not.toContain('jobs');
	});

	it("holds exactly the keys the worker's constructs read, on the compose network", () => {
		const env = worker(stack()).env!;

		expect(Object.keys(env).sort()).toEqual([
			'DATABASE_URL',
			'EVENT_PUBLISHER_CONNECTION_STRING',
			'GKM_EDGE_TOKEN',
			'NODE_ENV',
			'NOTES_PUBLISHER_CONNECTION_STRING',
			'PORT',
			'STAGE',
		]);
		expect(env.DATABASE_URL).toMatch(/@postgres:5432\/database$/);
		expect(env.NOTES_PUBLISHER_CONNECTION_STRING).toMatch(
			/^pgboss:\/\/[^@]+@postgres:5432\//,
		);
		expect(env.PORT).toBe('3000');
		// Not the auth server's secret, nor its database.
		expect(env).not.toHaveProperty('AUTH_SECRET');
		expect(env).not.toHaveProperty('AUTH_DATABASE_URL');
		expect(envFile(env)).toContain('PORT=3000\n');
	});

	it("is built inside Docker from its host app's slice, and runs its own bundle", () => {
		const s = stack();

		expect(worker(s).ref).toBe('compose-app/compose-app-jobs:abc1234');
		expect(s.compose.services.jobs?.build).toEqual({
			context: '../../..',
			dockerfile: '.gkm/compose/development/Dockerfile.jobs',
		});
		const dockerfile =
			s.dockerfiles['.gkm/compose/development/Dockerfile.jobs']!;
		expect(dockerfile).toContain(
			'node "$GKM_BIN" build --provider server --production',
		);
		expect(dockerfile).toContain(
			'COPY --from=builder --chown=hono:nodejs /app/apps/api/.gkm/server/dist/worker-jobs.mjs ./worker.mjs',
		);
		expect(dockerfile).toContain('CMD ["node", "worker.mjs"]');
		expect(dockerfile).toContain('/sbin/tini');
		expect(dockerfile).toContain('http://localhost:3000/health');
		expect(dockerfile).not.toContain('EXPOSE');
	});

	it('embeds nothing of the stage: it reads its env file at runtime', () => {
		const s = stack();

		expect(s.compose.services.jobs?.build).not.toHaveProperty('args');
		expect(s.compose).not.toHaveProperty('secrets');
		expect(worker(s).env).not.toHaveProperty('GKM_MASTER_KEY');
	});

	it('is pulled at the tag, with nothing to build', () => {
		const s = stack({
			images: { mode: 'pull', tag: 'v1.2.0', registry: 'r.example.com/acme' },
		});

		expect(worker(s).ref).toBe(
			'r.example.com/acme/compose-app/compose-app-jobs:v1.2.0',
		);
		expect(s.compose.services.jobs?.build).toBeUndefined();
		expect(s.dockerfiles).not.toHaveProperty(
			'.gkm/compose/v1.2.0/Dockerfile.jobs',
		);
	});

	it('runs on a deployed stage, its passwords derived from the seed', () => {
		const s = stack({ stage: 'production', secrets: production() });
		const env = worker(s).env!;

		expect(env.STAGE).toBe('production');
		expect(env.DATABASE_URL).toMatch(/@postgres:5432\//);
		expect(env.DATABASE_URL).not.toContain('geekmidas');
	});

	it('is enough for a stack to run, and a worker with no work is not', () => {
		const noSurfaces = Object.fromEntries(
			Object.entries(manifest).filter(
				([, d]) => d.kind !== 'rest-api' && d.kind !== 'site',
			),
		) as ConstructManifest;

		const s = stack({ manifest: noSurfaces });
		expect(s.apps).toEqual([]);
		expect(s.workers.map((w) => w.name)).toEqual(['jobs']);
		expect(() => stack({ manifest: noSurfaces, background: {} })).toThrow(
			NothingToCompose,
		);
	});
});

describe("a file server's processors", () => {
	/** The bucket and its file server, with a thumbnail processor in the API's app. */
	const withProcessors = (): ConstructManifest => {
		const services = withServices();
		return {
			...services,
			UploadsServer: {
				...services.UploadsServer,
				processors: [
					{
						id: 'thumbnails',
						handler: 'apps/api/processors/thumbnails.ts#thumbnails',
						path: '/i/:width/*',
						prefix: '/i/',
						native: ['sharp'],
						dependencies: [{ target: 'Uploads', kind: 'objects' }],
					},
				],
			},
		} as unknown as ConstructManifest;
	};
	const unit = (s: ComposeStack) =>
		s.processors.find((p) => p.name === 'uploads-processors')!;

	it('run in a container of their own, built from the app holding them', () => {
		const s = stack({ manifest: withProcessors() });

		expect(unit(s)).toMatchObject({
			id: 'UploadsServer',
			host: 'api',
			port: 3000,
			prefixes: ['/i/'],
		});
		const service = s.compose.services['uploads-processors']!;
		expect(service.ports).toBeUndefined();
		expect(service.env_file).toEqual([
			{ path: './uploads-processors.env', format: 'raw' },
		]);
		expect(service.healthcheck?.test).toContain('http://127.0.0.1:3000/health');
		expect(s.compose.services.caddy?.depends_on).toHaveProperty(
			'uploads-processors',
		);
	});

	it('read their bucket, on the compose network', () => {
		const env = unit(stack({ manifest: withProcessors() })).env!;

		expect(env.UPLOADS_CONNECTION_STRING).toMatch(/^s3:\/\//);
		expect(env.PORT).toBe('3000');
		// Not the API's secret: only what the processors reach.
		expect(env).not.toHaveProperty('AUTH_SECRET');
		expect(env).not.toHaveProperty('DATABASE_URL');
	});

	it("send telemetry only where their file server has the node's edge", () => {
		const base = withProcessors();
		const traced = stack({
			manifest: {
				...base,
				Telemetry: {
					kind: 'telemetry',
					id: 'Telemetry',
					provides: [...TELEMETRY_KEYS],
				},
				UploadsServer: { ...base.UploadsServer!, telemetry: 'Telemetry' },
			} as unknown as ConstructManifest,
		});

		expect(unit(traced).env?.OTEL_EXPORTER_OTLP_ENDPOINT).toMatch(
			/^http:\/\/openobserve:/,
		);
		expect(unit(traced).env?.OTEL_SERVICE_NAME).toBe('uploads-processors');
		expect(unit(stack({ manifest: base })).env).not.toHaveProperty(
			'OTEL_EXPORTER_OTLP_ENDPOINT',
		);
	});

	it("take their patterns on the file server's host, while the bucket keeps the rest", () => {
		const s = stack({ manifest: withProcessors() });
		const route = s.routes.find((r) => r.name === 'files-uploads-server')!;

		expect(route.handlers).toEqual([
			{
				name: 'uploads-processors',
				prefixes: ['/i/'],
				upstreams: [{ service: 'uploads-processors', port: 3000 }],
			},
		]);
		expect(route.upstreams).toEqual([{ service: 'minio', port: 9000 }]);
		expect(s.caddyfile).toContain('@handler0 path /i/*');
		// No host of their own: the file server's is theirs.
		expect(unit(s).origin).toBeUndefined();
	});

	it('install what their build left out — sharp — in their image, for linux', () => {
		const s = stack({ manifest: withProcessors() });
		const dockerfile =
			s.dockerfiles['.gkm/compose/development/Dockerfile.uploads-processors']!;

		expect(dockerfile).toContain('Processors Dockerfile (UploadsServer)');
		expect(dockerfile).toContain(
			'/app/apps/api/.gkm/server/dist/uploads-processors.mjs ./processors.mjs',
		);
		expect(dockerfile).toContain(
			'COPY --from=builder /app/apps/api/.gkm/server/dist/uploads-processors.externals.json ./package.json',
		);
		expect(dockerfile).toContain(
			'COPY --from=externals --chown=hono:nodejs /externals/node_modules ./node_modules',
		);
		expect(dockerfile).toContain('CMD ["node", "processors.mjs"]');
	});

	describe('behind a CDN', () => {
		/** A stage whose bucket is S3's, served by the CDN the deploy made. */
		const deployed = (custom: Record<string, string> = {}) =>
			stack({
				stage: 'production',
				manifest: withProcessors(),
				images: { mode: 'pull', tag: 'v1.4.0' },
				secrets: production({
					...EXTERNAL,
					UPLOADS_URL: 'https://uploads.shop.example.com',
					...custom,
				}),
				ports: {},
			});

		it('answer on a host only the CDN may call', () => {
			const s = deployed({ UPLOADS_SERVER_ORIGIN_SECRET: 'from-the-deploy' });

			expect(unit(s).origin).toEqual({
				host: 'uploads-processors.shop.example.com',
				secret: 'from-the-deploy',
			});
			expect(s.routes.find((r) => r.name === 'uploads-processors')).toEqual({
				name: 'uploads-processors',
				host: 'uploads-processors.shop.example.com',
				upstreams: [{ service: 'uploads-processors', port: 3000 }],
				streaming: false,
				prefixes: ['/i/'],
				requireHeader: {
					name: 'X-Gkm-Origin-Verify',
					value: 'from-the-deploy',
				},
				health: '/health',
			});
			expect(s.caddyfile).toContain(
				'@forged not header X-Gkm-Origin-Verify "from-the-deploy"',
			);
			// The secret is the edge's, never the processors' own.
			expect(Object.values(unit(s).env!)).not.toContain('from-the-deploy');
		});

		it('refuse to compose without the secret the CDN sends', () => {
			expect(() => deployed()).toThrow(ProcessorOriginSecretMissing);
			expect(() => deployed()).toThrow(/UPLOADS_SERVER_ORIGIN_SECRET/);
		});
	});
});

describe('a worker SNS pushes to', () => {
	/**
	 * The workspace with a topic the worker subscribes to: discovery nests the
	 * subscriber in the topic, owned by `Jobs`.
	 */
	const withTopic = (base: ConstructManifest = manifest): ConstructManifest =>
		({
			...base,
			Alerts: {
				kind: 'topic',
				id: 'Alerts',
				provides: ['ALERTS_PUBLISHER_CONNECTION_STRING'],
				events: ['alert.raised'],
				subscribers: [
					{
						id: 'onAlert',
						handler: 'subscribers/alerts.ts#onAlert',
						events: ['alert.raised'],
						dependencies: [],
						owner: 'Jobs',
					},
				],
			},
		}) as unknown as ConstructManifest;
	const SNS =
		'sns://AKIAEXAMPLE:secret@?topicArn=arn:aws:sns:eu-west-1:123456789012:alerts&region=eu-west-1';
	const ARN = (name: string) =>
		`arn:aws:sns:eu-west-1:123456789012:alerts:${name}-0b6c`;
	/** What the deploy recorded when it subscribed each route. */
	const RECORDED = {
		Jobs: { onAlert: ARN('onAlert'), onAlertAgain: ARN('onAlertAgain') },
	};

	const deployed = (overrides: Partial<StackInput> = {}) =>
		stack({
			stage: 'production',
			manifest: withTopic(),
			subscribers: {
				Jobs: [
					{
						name: 'onAlert',
						connectionKey: 'ALERTS_PUBLISHER_CONNECTION_STRING',
					},
					{
						name: 'onAlertAgain',
						connectionKey: 'ALERTS_PUBLISHER_CONNECTION_STRING',
					},
				],
			},
			images: { mode: 'pull', tag: 'v1.4.0' },
			secrets: production({ ALERTS_PUBLISHER_CONNECTION_STRING: SNS }),
			pushSubscriptions: RECORDED,
			ports: {},
			...overrides,
		});
	const jobs = (s: ComposeStack) => s.workers.find((w) => w.name === 'jobs')!;

	it("answers on its own host, on exactly its subscribers' routes", () => {
		const s = deployed();

		expect(jobs(s).push).toEqual({
			host: 'jobs.shop.example.com',
			url: 'https://jobs.shop.example.com',
			paths: ['/__gkm/subscribers/onAlert', '/__gkm/subscribers/onAlertAgain'],
			// What the deploy subscribes, one endpoint per subscriber.
			subscribers: [
				{
					name: 'onAlert',
					connectionKey: 'ALERTS_PUBLISHER_CONNECTION_STRING',
					endpoint: 'https://jobs.shop.example.com/__gkm/subscribers/onAlert',
				},
				{
					name: 'onAlertAgain',
					connectionKey: 'ALERTS_PUBLISHER_CONNECTION_STRING',
					endpoint:
						'https://jobs.shop.example.com/__gkm/subscribers/onAlertAgain',
				},
			],
		});
		expect(s.routes.find((r) => r.name === 'jobs')).toEqual({
			name: 'jobs',
			host: 'jobs.shop.example.com',
			upstreams: [{ service: 'jobs', port: 3000 }],
			streaming: false,
			paths: ['/__gkm/subscribers/onAlert', '/__gkm/subscribers/onAlertAgain'],
			health: '/health',
		});
		expect(s.caddyfile).toContain('https://jobs.shop.example.com {');
		expect(s.caddyfile).toContain('reverse_proxy jobs:3000');
		// The edge waits for it, as it does for every service it routes to.
		expect(s.compose.services.caddy?.depends_on).toHaveProperty('jobs');
	});

	it('is handed the subscriptions the deploy made, and subscribes nothing itself', () => {
		const env = jobs(deployed()).env!;

		expect(JSON.parse(env.GKM_SNS_SUBSCRIPTIONS!)).toEqual(RECORDED.Jobs);
		expect(env.ALERTS_PUBLISHER_CONNECTION_STRING).toBe(SNS);
		// Only an emulator's server subscribes itself, under this base.
		expect(env).not.toHaveProperty('GKM_SUBSCRIBER_PUSH_URL');
	});

	it('hands it only its own subscribers’ subscriptions', () => {
		const env = jobs(
			deployed({
				pushSubscriptions: {
					Jobs: { ...RECORDED.Jobs, somebodyElses: ARN('other') },
					Reports: { onReport: ARN('onReport') },
				},
			}),
		).env!;

		expect(JSON.parse(env.GKM_SNS_SUBSCRIPTIONS!)).toEqual(RECORDED.Jobs);
	});

	it('refuses a pushed subscriber the deploy recorded no subscription for', () => {
		const missing = () =>
			deployed({ pushSubscriptions: { Jobs: { onAlert: ARN('onAlert') } } });

		expect(missing).toThrow(PushSubscriptionMissing);
		expect(missing).toThrow(/'onAlertAgain' on the worker 'jobs'/);
		expect(() => deployed({ pushSubscriptions: undefined })).toThrow(
			PushSubscriptionMissing,
		);
	});

	it("is pushed to by a bucket's events, as by a topic", () => {
		const s = deployed({
			manifest: withTopic({
				...manifest,
				Uploads: {
					kind: 'objects',
					id: 'Uploads',
					provides: ['UPLOADS_CONNECTION_STRING'],
					subscribers: [
						{
							id: 'onAvatar',
							handler: 'subscribers/avatars.ts#onAvatar',
							events: ['object.created'],
							dependencies: [],
							owner: 'Jobs',
						},
					],
				},
			} as unknown as ConstructManifest),
			subscribers: {
				Jobs: [
					{
						name: 'onAvatar',
						connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING',
					},
				],
			},
			secrets: production({ UPLOADS_EVENTS_CONNECTION_STRING: SNS }),
			pushSubscriptions: { Jobs: { onAvatar: ARN('onAvatar') } },
		});

		expect(jobs(s).push?.paths).toEqual(['/__gkm/subscribers/onAvatar']);
		expect(JSON.parse(jobs(s).env!.GKM_SNS_SUBSCRIPTIONS!)).toEqual({
			onAvatar: ARN('onAvatar'),
		});
		expect(jobs(s).env?.UPLOADS_EVENTS_CONNECTION_STRING).toBe(SNS);
		expect(jobs(s).env).not.toHaveProperty('UPLOADS_CONNECTION_STRING');
	});

	it('stays private while its topics are on pg-boss', () => {
		const s = deployed({ secrets: production() });

		expect(jobs(s).push).toBeUndefined();
		expect(jobs(s).env).not.toHaveProperty('GKM_SNS_SUBSCRIPTIONS');
		expect(s.routes.map((r) => r.name)).not.toContain('jobs');
		expect(s.caddyfile).not.toContain('jobs');
	});

	it('stays private on the local stage, where the emulator pushes to the host', () => {
		const s = stack({
			manifest: withTopic(),
			subscribers: {
				Jobs: [
					{
						name: 'onAlert',
						connectionKey: 'ALERTS_PUBLISHER_CONNECTION_STRING',
					},
				],
			},
		});

		expect(jobs(s).push).toBeUndefined();
		expect(s.routes.map((r) => r.name)).not.toContain('jobs');
	});

	it('needs the stage to have a domain to answer on', () => {
		expect(() =>
			deployed({ workspace: { ...workspace, domains: {} } }),
		).toThrow(NoDomainForStage);
	});

	it('refuses a host an app already answers on', () => {
		// The API on the subdomain the worker would take.
		const run = () =>
			deployed({
				workspace: {
					...workspace,
					apps: {
						...workspace.apps,
						api: { ...workspace.apps.api!, subdomain: 'jobs' },
					},
				},
			});

		expect(run).toThrow(EdgeHostTaken);
		expect(run).toThrow(/'api' and 'jobs' would both answer on jobs\.shop/);
	});
});

describe("a watched bucket in the stack's MinIO", () => {
	/** The workspace with a bucket a subscriber in `Jobs` watches. */
	const watched = (overrides: Partial<StackInput> = {}) =>
		stack({
			manifest: {
				...manifest,
				Uploads: {
					kind: 'objects',
					id: 'Uploads',
					provides: ['UPLOADS_CONNECTION_STRING'],
					subscribers: [
						{
							id: 'onAvatar',
							handler: 'subscribers/avatars.ts#onAvatar',
							events: ['object.created'],
							dependencies: [],
							owner: 'Jobs',
						},
					],
				},
				Reports: {
					kind: 'objects',
					id: 'Reports',
					provides: ['REPORTS_CONNECTION_STRING'],
				},
			} as unknown as ConstructManifest,
			subscribers: {
				Jobs: [
					{
						name: 'onAvatar',
						connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING',
					},
				],
			},
			...overrides,
		});
	const jobs = (s: ComposeStack) => s.workers.find((w) => w.name === 'jobs')!;

	it('posts its events to the worker running its subscriber, which relays them onto pg-boss', () => {
		const s = watched();
		const env = jobs(s).env!;

		// Delivered from the stack's broker, by its name on the network.
		expect(env.UPLOADS_EVENTS_CONNECTION_STRING).toMatch(
			/^pgboss:\/\/[^@]+@postgres:5432\//,
		);
		expect(env.UPLOADS_EVENTS_TOKEN).toMatch(/^[\w-]{32}$/);
		// Not the bucket itself: binding to its events is not reading it.
		expect(env).not.toHaveProperty('UPLOADS_CONNECTION_STRING');

		expect(s.storage?.webhooks).toEqual([
			{
				bucket: 'Uploads',
				endpoint: 'http://jobs:3000/__gkm/objects/Uploads',
				token: env.UPLOADS_EVENTS_TOKEN,
			},
		]);
		expect(s.compose.services.minio?.environment).toMatchObject({
			MINIO_NOTIFY_WEBHOOK_ENABLE_UPLOADS: 'on',
			MINIO_NOTIFY_WEBHOOK_ENDPOINT_UPLOADS:
				'http://jobs:3000/__gkm/objects/Uploads',
			MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_UPLOADS: env.UPLOADS_EVENTS_TOKEN,
			MINIO_NOTIFY_WEBHOOK_QUEUE_DIR_UPLOADS: '/gkm-object-events/uploads',
		});
		// On the stack's own network: nothing on the host to map.
		expect(s.compose.services.minio?.extra_hosts).toBeUndefined();
		expect(s.storage?.objects.map((b) => b.id).sort()).toEqual([
			'Reports',
			'Uploads',
		]);
	});

	it('declares no target for a bucket nothing watches', () => {
		const environment = watched().compose.services.minio?.environment ?? {};

		expect(
			Object.keys(environment).filter((k) => k.includes('REPORTS')),
		).toEqual([]);
		const unwatched = watched({ subscribers: {} });
		expect(unwatched.storage?.webhooks).toEqual([]);
		expect(jobs(unwatched).env).not.toHaveProperty(
			'UPLOADS_EVENTS_CONNECTION_STRING',
		);
		expect(
			Object.keys(unwatched.compose.services.minio?.environment ?? {}).filter(
				(k) => k.startsWith('MINIO_NOTIFY'),
			),
		).toEqual([]);
	});

	it("signs with a token derived from a deployed stage's seed", () => {
		const deployed = (seed: string) =>
			watched({
				stage: 'production',
				images: { mode: 'pull', tag: 'v1.4.0' },
				secrets: { ...production(), seed },
				ports: {},
				allowDevServices: true,
			});
		const token = (s: ComposeStack) => jobs(s).env?.UPLOADS_EVENTS_TOKEN;

		expect(token(deployed('a-random-seed'))).toBe(
			token(deployed('a-random-seed')),
		);
		expect(token(deployed('a-random-seed'))).not.toBe(
			token(deployed('another-seed')),
		);
		expect(token(deployed('a-random-seed'))).not.toBe(token(watched()));
		expect(deployed('a-random-seed').storage?.webhooks[0]?.token).toBe(
			token(deployed('a-random-seed')),
		);
	});

	it('posts nothing where the stage says its events come from SNS', () => {
		const SNS =
			'sns://AKIAEXAMPLE:secret@?topicArn=arn:aws:sns:eu-west-1:123456789012:uploads&region=eu-west-1';
		const s = watched({
			stage: 'production',
			images: { mode: 'pull', tag: 'v1.4.0' },
			secrets: production({ UPLOADS_EVENTS_CONNECTION_STRING: SNS }),
			ports: {},
			allowDevServices: true,
			// What the deploy records once it has subscribed the worker's route.
			pushSubscriptions: {
				Jobs: { onAvatar: 'arn:aws:sns:eu-west-1:123456789012:uploads:1' },
			},
		});

		expect(jobs(s).env?.UPLOADS_EVENTS_CONNECTION_STRING).toBe(SNS);
		expect(s.storage?.webhooks).toEqual([]);
	});

	it('relays nothing for a bucket the stage brings itself', () => {
		const s = watched({
			stage: 'production',
			images: { mode: 'pull', tag: 'v1.4.0' },
			secrets: production({
				UPLOADS_CONNECTION_STRING: 's3://acme-uploads?region=eu-west-1',
				REPORTS_CONNECTION_STRING: 's3://acme-reports?region=eu-west-1',
			}),
			ports: {},
		});

		expect(jobs(s).env).not.toHaveProperty('UPLOADS_EVENTS_CONNECTION_STRING');
		expect(jobs(s).env).not.toHaveProperty('UPLOADS_EVENTS_TOKEN');
		expect(s.storage).toBeUndefined();
	});
});

describe('the cache', () => {
	const deployed = (custom: Record<string, string> = {}) =>
		stack({
			stage: 'production',
			images: { mode: 'pull', tag: 'v1.4.0' },
			secrets: production(custom),
			ports: {},
		});

	it("runs the stack's Redis: pinned, unpublished, bounded, persisted, checked and rotated", () => {
		const s = deployed();
		const redis = s.compose.services.redis!;

		expect(s.infra).toContain('redis');
		// Reconcile's pin, so `gkm dev` and the stack run one Redis.
		expect(redis.image).toBe(REDIS_IMAGE);
		expect(REDIS_IMAGE).toBe('redis:8-alpine');
		// On the compose network alone: nothing on the host reaches it.
		expect(redis).not.toHaveProperty('ports');
		expect(redis.restart).toBe('unless-stopped');
		expect(redis.volumes).toEqual(['redis-data:/data']);
		expect(s.compose.volumes).toHaveProperty('redis-data');

		const command = (redis.command as string[]).join(' ');
		expect(command).toContain('docker-entrypoint.sh redis-server');
		expect(command).toContain('--maxmemory 256mb');
		expect(command).toContain('--maxmemory-policy allkeys-lru');
		expect(command).toContain('--appendonly yes');
		// The password by name, read from the env file — never its value.
		expect(command).toContain('--requirepass "$$REDIS_PASSWORD"');
		expect(command).not.toContain('the-redis-password');
		expect(redis.env_file).toEqual([{ path: './redis.env', format: 'raw' }]);
		expect(s.redis?.env).toEqual({
			REDIS_PASSWORD: 'the-redis-password',
			REDISCLI_AUTH: 'the-redis-password',
		});

		expect(redis.healthcheck?.test).toEqual([
			'CMD-SHELL',
			'redis-cli ping | grep -q PONG',
		]);
		expect(JSON.stringify(redis.healthcheck)).not.toContain(
			'the-redis-password',
		);
		expect(redis.logging).toEqual({
			driver: 'json-file',
			options: { 'max-size': '10m', 'max-file': '3' },
		});

		// Every backend and worker waits for it.
		for (const name of ['api', 'auth', 'jobs']) {
			expect(s.compose.services[name]?.depends_on).toHaveProperty('redis');
		}
	});

	it("hands each backend that reads the cache its URL on the network, with the stage's password", () => {
		const s = deployed();

		expect(app(s, 'api').env?.SESSIONS_URL).toBe(
			'redis://:the-redis-password@redis:6379/0',
		);
		// Only to the apps that read it.
		expect(app(s, 'auth').env).not.toHaveProperty('SESSIONS_URL');
		expect(envFile(app(s, 'api').env!)).toContain(
			'SESSIONS_URL=redis://:the-redis-password@redis:6379/0\n',
		);
	});

	it('keeps the cache out of the database it was declared from', () => {
		const s = deployed();
		const cache = s.plan.resources.find((r) => r.id === 'Sessions')!;

		expect(cache.container).toBe('redis');
		expect(cache).not.toHaveProperty('of');
		// No table is created for it.
		const statements = postgresStatements(
			s.plan,
			workspace.name,
			'a-random-seed',
		);
		expect(statements.length).toBeGreaterThan(0);
		expect(statements.filter((st) => st.id === 'Sessions')).toEqual([]);
	});

	it("uses this machine's generated password on the local stage, as gkm dev does", () => {
		const s = stack();

		expect(s.redis?.password).toBe(LOCAL_REDIS_PASSWORD);
		expect(app(s, 'api').env?.SESSIONS_URL).toBe(
			`redis://:${LOCAL_REDIS_PASSWORD}@redis:6379/0`,
		);
	});

	it("escapes a password the stage set that a URL's userinfo cannot hold", () => {
		const s = deployed({ REDIS_PASSWORD: 'p@ss:w/rd' });

		expect(app(s, 'api').env?.SESSIONS_URL).toBe(
			'redis://:p%40ss%3Aw%2Frd@redis:6379/0',
		);
		expect(s.redis?.env.REDIS_PASSWORD).toBe('p@ss:w/rd');
	});

	it('refuses a deployed stage with no password yet', () => {
		expect(() =>
			stack({
				stage: 'production',
				images: { mode: 'pull', tag: 'v1.4.0' },
				secrets: { ...production(), custom: { AUTH_SECRET: 'x' } },
				ports: {},
			}),
		).toThrow(RedisPasswordMissing);
	});

	it("runs no Redis where the stage set the cache's URL — a managed Redis — and uses it", () => {
		const managed = 'rediss://default:token@cache.example.com:6380';
		const s = deployed({ SESSIONS_URL: managed });

		expect(s.infra).not.toContain('redis');
		expect(s.compose.services).not.toHaveProperty('redis');
		expect(s.compose.volumes).not.toHaveProperty('redis-data');
		expect(s.redis).toBeUndefined();
		expect(app(s, 'api').env?.SESSIONS_URL).toBe(managed);
		expect(s.compose.services.api?.depends_on).not.toHaveProperty('redis');
	});

	it('gives each cache a database of its own', () => {
		const s = stack({
			manifest: {
				...manifest,
				Rates: { kind: 'cache', id: 'Rates', provides: ['RATES_URL'] },
			} as ConstructManifest,
		});

		expect(s.plan.resources.filter((r) => r.kind === 'cache')).toHaveLength(2);
		expect(s.redis?.urls).toEqual({
			RATES_URL: `redis://:${LOCAL_REDIS_PASSWORD}@redis:6379/0`,
			SESSIONS_URL: `redis://:${LOCAL_REDIS_PASSWORD}@redis:6379/1`,
		});
	});

	it("builds each backend and worker to register the Redis driver, which `gkm docker`'s Dockerfile does not", () => {
		const s = stack();

		for (const name of ['api', 'jobs']) {
			expect(
				s.dockerfiles[`.gkm/compose/development/Dockerfile.${name}`],
			).toContain(
				'node "$GKM_BIN" build --provider server --production --cache redis',
			);
		}
	});

	it('runs no Redis for a workspace that declares no cache', () => {
		const { Sessions: _, ...without } = manifest;
		const s = stack({ manifest: without as ConstructManifest });

		expect(s.infra).not.toContain('redis');
		expect(s.redis).toBeUndefined();
	});
});

describe('a stack that only builds (--build --push)', () => {
	const pushing = () =>
		stack({
			stage: 'production',
			secrets: production(),
			images: {
				mode: 'build',
				tag: 'abc1234',
				registry: 'registry.example.com/acme',
			},
			buildOnly: true,
		});

	it('builds every image, a backend at the commit and a site at <tag>-<stage>', () => {
		const s = pushing();

		expect(app(s, 'api').ref).toBe(
			'registry.example.com/acme/compose-app/compose-app-api:abc1234',
		);
		expect(app(s, 'web').ref).toBe(
			'registry.example.com/acme/compose-app/compose-app-web:abc1234-production',
		);
		for (const name of ['api', 'auth', 'web', 'jobs']) {
			expect(s.compose.services[name]?.build).toBeDefined();
		}
	});

	it("still builds the site with the stage's public URLs", () => {
		expect(pushing().compose.services.web?.build?.args).toEqual({
			WEB_URL: 'https://shop.example.com',
			VITE_WEB_URL: 'https://shop.example.com',
			VITE_API_URL: 'https://api.shop.example.com',
			VITE_AUTH_URL: 'https://auth.shop.example.com',
		});
	});

	it('resolves no runtime env, so no backend secret is needed', () => {
		const s = stack({
			stage: 'production',
			// No AUTH_SECRET: a deploy of this stage would refuse it. (Redis's
			// password is one the stage generates, so a push run has it.)
			secrets: {
				...production(),
				custom: { REDIS_PASSWORD: 'the-redis-password' },
			},
			images: { mode: 'build', tag: 'abc1234' },
			buildOnly: true,
		});

		expect(app(s, 'api').env).toBeUndefined();
		expect(app(s, 'auth').env).toBeUndefined();
		expect(s.workers[0]?.env).toBeUndefined();
		for (const service of Object.values(s.compose.services)) {
			expect(service.env_file).toBeUndefined();
		}
	});
});

describe('a WebSocket surface', () => {
	let realtimeDir: string;
	let realtime: Awaited<ReturnType<typeof loadComposeApp>>;

	beforeAll(async () => {
		realtimeDir = realpathSync(await createTempDir('gkm-compose-realtime-'));
		writeComposeApp(realtimeDir, { realtime: true });
		realtime = await loadComposeApp(realtimeDir);
	});

	afterAll(async () => {
		await cleanupDir(realtimeDir);
	});

	const deployed = (proxy?: 'traefik') =>
		composeStack({
			workspace: proxy
				? {
						...realtime.workspace,
						deploy: {
							...realtime.workspace.deploy,
							compose: { ...realtime.workspace.deploy?.compose, proxy },
						},
					}
				: realtime.workspace,
			manifest: realtime.manifest,
			background: realtime.background,
			stage: 'production',
			identity: deployIdentity(realtime.workspace, 'production'),
			images: { mode: 'pull', tag: 'v1.4.0' },
			secrets: production(),
			ports: {},
			localCredentials: TEST_CREDENTIALS,
		});

	it('runs one container per replica, each an upstream of its one route', () => {
		const s = deployed();

		for (const name of ['realtime', 'realtime-2', 'realtime-3']) {
			const service = s.compose.services[name]!;
			expect(service.image).toBe(app(s, 'realtime').ref);
			expect(service.env_file).toEqual([
				{ path: './realtime.env', format: 'raw' },
			]);
			expect(service.healthcheck?.test).toEqual(
				expect.arrayContaining([expect.stringContaining('/health')]),
			);
			expect(service.ulimits).toEqual({
				nofile: { soft: 1_048_576, hard: 1_048_576 },
			});
			expect(service.depends_on).toHaveProperty('redis');
			expect(s.compose.services.caddy?.depends_on).toHaveProperty(name);
		}

		const route = s.routes.find((r) => r.name === 'realtime')!;
		expect(route.upstreams).toEqual([
			{ service: 'realtime', port: app(s, 'realtime').port },
			{ service: 'realtime-2', port: app(s, 'realtime').port },
			{ service: 'realtime-3', port: app(s, 'realtime').port },
		]);
		expect(route.health).toBe('/health');
	});

	it('answers on wss://, and meets its senders on the stack Redis', () => {
		const s = deployed();
		const realtimeApp = app(s, 'realtime');

		expect(realtimeApp.kind).toBe('websocket-api');
		expect(realtimeApp.url).toBe(`wss://${realtimeApp.host}`);
		expect(s.infra).toContain('redis');

		const publisher = 'redis://:the-redis-password@redis:6379';
		expect(realtimeApp.env?.REALTIME_PUBLISHER_CONNECTION_STRING).toBe(
			publisher,
		);
		expect(realtimeApp.env?.REALTIME_URL).toBe(realtimeApp.url);
		// The API sends to it, so it holds the same publisher — and reaches
		// the surface at its public address.
		expect(app(s, 'api').env?.REALTIME_PUBLISHER_CONNECTION_STRING).toBe(
			publisher,
		);
		expect(app(s, 'api').env?.REALTIME_URL).toBe(realtimeApp.url);
		// Nothing else reaches it.
		expect(app(s, 'auth').env).not.toHaveProperty(
			'REALTIME_PUBLISHER_CONNECTION_STRING',
		);
	});

	it('limits each client address at the edge, as the surface declares', () => {
		const s = deployed('traefik');
		const route = s.routes.find((r) => r.name === 'realtime')!;
		expect(route.limits).toEqual({
			handshakesPerMinute: 120,
			connectionsPerIp: 256,
		});
		// Only the surface's route: an API has no such limit.
		expect(s.routes.find((r) => r.name === 'api')?.limits).toBeUndefined();
	});

	it('widens the edge for the connections it holds', () => {
		const caddy = deployed().compose.services.caddy!;

		expect(caddy.sysctls).toEqual({
			'net.ipv4.ip_local_port_range': '1024 65535',
		});
		expect(caddy.ulimits).toEqual({
			nofile: { soft: 1_048_576, hard: 1_048_576 },
		});
	});
});
