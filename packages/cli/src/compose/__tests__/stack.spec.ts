import { realpathSync } from 'node:fs';
import { type ConstructManifest, TELEMETRY_KEYS } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { ExternalServicesNotConfigured } from '../../deploy/devServices';
import { deployIdentity } from '../../deploy/identity';
import { StageProviderDisabled } from '../../providers/notes';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { localRolePassword } from '../../reconcile/env';
import { postgresSuperuser } from '../../reconcile/localCredentials';
import { postgresStatements } from '../../reconcile/provision';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import type { NormalizedWorkspace } from '../../workspace/types';
import { REDIS_IMAGE, RedisPasswordMissing } from '../redis';
import {
	type ComposeStack,
	composeStack,
	envFile,
	LocalCredentialsMissing,
	NothingToCompose,
	type StackInput,
	StageSecretMissing,
	StageSeedMissing,
} from '../stack';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;
let background: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-stack-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	({ workspace, manifest, runnables, background } = await loadComposeApp(dir));
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
		runnables,
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

	it('serves each app on its *.localhost host, through the published edge', () => {
		const s = stack();

		expect(app(s, 'api').url).toBe('https://api.compose-app.localhost:8443');
		expect(app(s, 'auth').url).toBe('https://auth.compose-app.localhost:8443');
		// The site the base domain points at answers on the project's bare host.
		expect(app(s, 'web').url).toBe('https://compose-app.localhost:8443');
		expect(s.compose.services.caddy?.ports).toEqual(['8443:443', '8080:80']);
	});

	it("issues the edge's certificates from Caddy's internal CA", () => {
		const { caddyfile } = stack();

		expect(caddyfile).toContain('local_certs');
		expect(caddyfile).toContain(`https://api.compose-app.localhost {
	tls internal`);
		expect(caddyfile).toContain('reverse_proxy api:3000');
		expect(caddyfile).toContain('reverse_proxy auth:3001');
		expect(caddyfile).toContain('https://compose-app.localhost {');
		// A streamed response reaches the browser as it is written.
		expect(caddyfile.match(/flush_interval -1/g)).toHaveLength(3);
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
		// cookie domain are its own settings, as its secret is.
		expect(Object.keys(env).sort()).toEqual([
			'API_COOKIE_DOMAIN',
			'API_TRUSTED_ORIGINS',
			'API_URL',
			'AUTH_URL',
			'DATABASE_URL',
			'EVENT_PUBLISHER_CONNECTION_STRING',
			'NODE_ENV',
			'NOTES_PUBLISHER_CONNECTION_STRING',
			'PORT',
			'SESSIONS_URL',
			'STAGE',
		]);
	});

	it('reaches a sibling on the compose network, and names itself by its public address', () => {
		const env = app(stack(), 'api').env!;

		expect(env.AUTH_URL).toBe('http://auth:3001');
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

	it('trusts the browser origins and the internal origin of every service that calls it', () => {
		const env = app(stack(), 'auth').env!;

		expect(env.AUTH_TRUSTED_ORIGINS!.split(',')).toEqual([
			'https://api.compose-app.localhost:8443',
			'https://compose-app.localhost:8443',
			'http://api:3000',
		]);
	});

	it('scopes the session cookie to the parent of the public hosts', () => {
		expect(app(stack(), 'auth').env!.AUTH_COOKIE_DOMAIN).toBe(
			'.compose-app.localhost',
		);
	});

	it('never carries a secret the app does not read', () => {
		const s = stack({
			secrets: {
				...initStageSecrets('development'),
				custom: { AUTH_SECRET: 'set-by-hand', STRIPE_KEY: 'sk_live_x' },
			},
		});

		expect(app(s, 'auth').env!.AUTH_SECRET).toBe('set-by-hand');
		expect(app(s, 'auth').env).not.toHaveProperty('STRIPE_KEY');
		expect(app(s, 'api').env).not.toHaveProperty('AUTH_SECRET');
		expect(app(s, 'api').env).not.toHaveProperty('STRIPE_KEY');
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
	it('is built with its public URLs as build args', () => {
		const s = stack();

		expect(s.compose.services.web?.build?.args).toEqual({
			VITE_API_URL: 'https://api.compose-app.localhost:8443',
			VITE_AUTH_URL: 'https://auth.compose-app.localhost:8443',
		});
		const dockerfile = s.dockerfiles['.gkm/compose/development/Dockerfile.web'];
		expect(dockerfile).toContain('ARG VITE_API_URL=""');
		expect(dockerfile).toContain('ARG VITE_AUTH_URL=""');
	});

	it('gets no server env and waits on no infrastructure', () => {
		const web = stack().compose.services.web!;

		expect(web.env_file).toBeUndefined();
		expect(web.environment).toBeUndefined();
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

	it("answers on the stage's domains, with certificates from ACME", () => {
		const s = deployed();

		expect(app(s, 'api').url).toBe('https://api.shop.example.com');
		expect(app(s, 'web').url).toBe('https://shop.example.com');
		expect(s.caddyfile).not.toContain('tls internal');
		expect(s.caddyfile).not.toContain('local_certs');
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
		Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
		UploadsServer: {
			kind: 'file-server',
			id: 'UploadsServer',
			of: 'Uploads',
			open: ['brand/**'],
			provides: ['UPLOADS_SERVER_URL'],
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
	UPLOADS_URL: 's3://acme-uploads?region=eu-west-1',
	AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
	AWS_SECRET_ACCESS_KEY: 'external-secret',
	UPLOADS_SERVER_URL: 'https://files.shop.example.com',
};

describe('mail and storage on the local stage', () => {
	it('runs MinIO and Mailpit with no secret, and creates the bucket', () => {
		const s = stack({ manifest: withServices() });
		const api = app(s, 'api').env!;

		expect(s.infra).toEqual(['mailpit', 'minio', 'postgres', 'redis']);
		expect(api.UPLOADS_URL).toBe(
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

	it("serves the file server on the edge, at gkm dev's host for it", () => {
		const s = stack({ manifest: withServices() });

		expect(app(s, 'web').build?.args?.VITE_UPLOADS_SERVER_URL).toBe(
			'https://uploadsserver.compose-app.localhost:8443',
		);
		expect(s.caddyfile).toContain(
			'https://uploadsserver.compose-app.localhost {',
		);
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

	it('refuses a stage whose secrets configure neither, naming every key at once', () => {
		let error: unknown;
		try {
			deployed();
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(ExternalServicesNotConfigured);
		const missing = (error as ExternalServicesNotConfigured).missing;
		expect(missing.map((m) => m.key)).toEqual([
			'MAIL_URL',
			'MAIL_FROM',
			'UPLOADS_URL',
			'UPLOADS_SERVER_URL',
		]);
		// A bucket's credentials are optional, so neither half is asked for.
		expect(missing.map((m) => m.key)).not.toContain('AWS_ACCESS_KEY_ID');
		const message = (error as Error).message;
		for (const { key } of missing) {
			expect(message).toContain(`gkm secrets:set ${key} '`);
		}
		expect(message).toContain('--stage production');
		expect(message).toContain('with --allow-dev-services.');
		expect(message).not.toMatch(/--allow-dev-services (minio|mailpit)/);
		expect(missing.find((m) => m.key === 'MAIL_URL')?.apps).toEqual(['api']);
		// The API signs uploads to the bucket and hands out URLs on the domain
		// that serves it, so it reads the file server's address as the site does.
		expect(missing.find((m) => m.key === 'UPLOADS_SERVER_URL')?.apps).toEqual([
			'api',
			'web',
		]);
	});

	it("runs neither where the stage's secrets configure both", () => {
		const s = deployed({ secrets: production(EXTERNAL) });
		const api = app(s, 'api').env!;

		expect(s.infra).toEqual(['postgres', 'redis']);
		expect(s.compose.services).not.toHaveProperty('minio');
		expect(s.compose.services).not.toHaveProperty('mailpit');
		expect(api.MAIL_URL).toBe(EXTERNAL.MAIL_URL);
		expect(api.MAIL_FROM).toBe(EXTERNAL.MAIL_FROM);
		expect(api.UPLOADS_URL).toBe(EXTERNAL.UPLOADS_URL);
		expect(api.AWS_ACCESS_KEY_ID).toBe(EXTERNAL.AWS_ACCESS_KEY_ID);
		expect(api.AWS_SECRET_ACCESS_KEY).toBe(EXTERNAL.AWS_SECRET_ACCESS_KEY);
		expect(app(s, 'web').build).toBeUndefined();
		expect(s.caddyfile).not.toContain('minio');
		expect(s.devServices).toEqual([]);
	});

	it("signs with the bucket URL's own key, and hands the app no shared pair", () => {
		const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ...rest } = EXTERNAL;
		const UPLOADS_URL =
			's3://AKIAUPLOADS:a%2Fsecret%2Bvalue@acme-uploads?region=eu-west-1';
		const s = deployed({ secrets: production({ ...rest, UPLOADS_URL }) });
		const api = app(s, 'api').env!;

		expect(s.infra).toEqual(['postgres', 'redis']);
		expect(api.UPLOADS_URL).toBe(UPLOADS_URL);
		expect(api).not.toHaveProperty('AWS_ACCESS_KEY_ID');
		expect(api).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
	});

	it('deploys a bucket with no credentials at all, for a role to sign', () => {
		const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ...rest } = EXTERNAL;
		const s = deployed({ secrets: production(rest) });
		const api = app(s, 'api').env!;

		expect(api.UPLOADS_URL).toBe(EXTERNAL.UPLOADS_URL);
		expect(api).not.toHaveProperty('AWS_ACCESS_KEY_ID');
		expect(api).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
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
		expect(api.UPLOADS_URL).toBe(
			's3://uploads-production?region=us-east-1&endpoint=http://minio:9000&forcePathStyle=true',
		);
		expect(api.AWS_ACCESS_KEY_ID).toBe('compose-app-minio');
		expect(api.AWS_SECRET_ACCESS_KEY).toBe(password);
		expect(api.MAIL_URL).toBe('smtp://mailpit:1025');
		expect(api.MAIL_FROM).toBe('noreply@shop.example.com');
		// Mailpit's inbox is not a deployed stage's to hand out.
		expect(api).not.toHaveProperty('MAIL_INBOX_URL');
		expect(s.storage?.buckets).toEqual(['uploads-production']);
		expect(s.caddyfile).toContain('https://uploads-server.shop.example.com {');
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
				UPLOADS_SERVER_URL: EXTERNAL.UPLOADS_SERVER_URL,
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
		expect(s.caddyfile).not.toContain('uploads-server');
		expect(s.devServices).toEqual([{ service: 'minio', ids: ['Uploads'] }]);
	});

	describe("with a provider backing the stage's buckets", () => {
		const withS3 = () => ({
			...workspace,
			deploy: {
				...workspace.deploy,
				objects: { production: { provider: 's3' as const } },
			},
		});

		it('runs no MinIO under --allow-dev-services: the provider accounts for buckets', () => {
			let error: unknown;
			try {
				deployed({ workspace: withS3(), allowDevServices: true });
			} catch (caught) {
				error = caught;
			}

			// Mail is still a dev service's; the bucket and its server are the
			// provider's, so they are asked for — with what creates them.
			expect(error).toBeInstanceOf(ExternalServicesNotConfigured);
			const missing = (error as ExternalServicesNotConfigured).missing;
			expect(missing.map((m) => m.key)).toEqual([
				'UPLOADS_URL',
				'UPLOADS_SERVER_URL',
			]);
			expect(missing[0]?.service).toBeUndefined();
			const message = (error as Error).message;
			expect(message).toContain(
				'deploy.objects.production is s3: gkm setup --stage production creates it and writes this key',
			);
			expect(message).toContain('AWS_PROFILE');
			// Nothing missing could be a dev service, so none is offered.
			expect(message).not.toContain('--allow-dev-services');
		});

		it('deploys with the keys the provider wrote, and runs mail on Mailpit', () => {
			const s = deployed({
				workspace: withS3(),
				allowDevServices: true,
				secrets: production({
					UPLOADS_URL:
						's3://AKIAUPLOADS:secret@compose-app-production-uploads?region=eu-west-1',
					UPLOADS_SERVER_URL:
						'https://compose-app-production-uploads.s3.eu-west-1.amazonaws.com',
				}),
			});

			expect(s.infra).toEqual(['mailpit', 'postgres', 'redis']);
			expect(s.devServices).toEqual([{ service: 'mailpit', ids: ['Mail'] }]);
		});

		it('refuses a bucket on a stage that has none', () => {
			const none = {
				...workspace,
				deploy: {
					...workspace.deploy,
					objects: { production: false as const },
				},
			};
			expect(() =>
				deployed({ workspace: none, secrets: production(EXTERNAL) }),
			).toThrow(StageProviderDisabled);
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
