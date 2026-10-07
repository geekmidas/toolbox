import { realpathSync } from 'node:fs';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { ExternalServicesNotConfigured } from '../../deploy/devServices';
import { deployIdentity } from '../../deploy/identity';
import { localRolePassword } from '../../reconcile/env';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	type ComposeStack,
	composeStack,
	envFile,
	type StackInput,
	StageSecretMissing,
	StageSeedMissing,
} from '../stack';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-stack-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	({ workspace, manifest, runnables } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
});

/** A deployed stage's secrets, as a first run generates them. */
function production(custom: Record<string, string> = {}): StageSecrets {
	return {
		...initStageSecrets('production'),
		seed: 'a-random-seed',
		custom: { AUTH_SECRET: 'the-production-signing-secret', ...custom },
	};
}

function stack(overrides: Partial<StackInput> = {}): ComposeStack {
	const stage = overrides.stage ?? 'development';
	return composeStack({
		workspace,
		manifest,
		runnables,
		stage,
		identity: deployIdentity(workspace, stage),
		images: { mode: 'build', tag: 'abc1234' },
		ports: { https: 8443, http: 8080 },
		...overrides,
	});
}

const app = (s: ComposeStack, name: string) =>
	s.apps.find((candidate) => candidate.name === name)!;

describe('the local stage', () => {
	it('runs every API and site, the database they need, and one edge', () => {
		const s = stack();

		expect(s.project).toBe('compose-app-development');
		expect(Object.keys(s.compose.services).sort()).toEqual([
			'api',
			'auth',
			'caddy',
			'postgres',
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

describe("a backend's env file", () => {
	it('holds exactly the keys the API reads', () => {
		const env = app(stack(), 'api').env!;

		expect(Object.keys(env).sort()).toEqual([
			'API_COOKIE_DOMAIN',
			'API_TRUSTED_ORIGINS',
			'API_URL',
			'AUTH_COOKIE_DOMAIN',
			'AUTH_TRUSTED_ORIGINS',
			'AUTH_URL',
			'NODE_ENV',
			'PORT',
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
		expect(s.compose.services.postgres?.environment?.POSTGRES_PASSWORD).toBe(
			s.credential.master,
		);
		expect(s.credential.master).not.toBe('geekmidas');
	});

	it('refuses a stage whose secrets have no seed', () => {
		expect(() =>
			deployed({ secrets: { ...production(), seed: undefined } }),
		).toThrow(StageSeedMissing);
	});

	it('refuses a secret the stage was never given, naming the key', () => {
		const run = () => deployed({ secrets: { ...production(), custom: {} } });

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

		expect(s.infra).toEqual(['mailpit', 'minio', 'postgres']);
		expect(api.UPLOADS_URL).toBe(
			's3://uploads?region=us-east-1&endpoint=http://minio:9000&forcePathStyle=true',
		);
		expect(api.AWS_ACCESS_KEY_ID).toBe('geekmidas');
		expect(api.AWS_SECRET_ACCESS_KEY).toBe('geekmidas');
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
			'AWS_ACCESS_KEY_ID',
			'AWS_SECRET_ACCESS_KEY',
			'UPLOADS_SERVER_URL',
		]);
		const message = (error as Error).message;
		for (const { key } of missing) {
			expect(message).toContain(`gkm secrets:set ${key} '`);
		}
		expect(message).toContain('--stage production');
		expect(message).toContain('--allow-dev-services mailpit,minio');
		expect(missing.find((m) => m.key === 'MAIL_URL')?.apps).toEqual(['api']);
		expect(missing.find((m) => m.key === 'UPLOADS_SERVER_URL')?.apps).toEqual([
			'web',
		]);
	});

	it("runs neither where the stage's secrets configure both", () => {
		const s = deployed({ secrets: production(EXTERNAL) });
		const api = app(s, 'api').env!;

		expect(s.infra).toEqual(['postgres']);
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

	it('runs MinIO and Mailpit where allowed, with keys derived from them', () => {
		const s = deployed({ allowDevServices: ['minio', 'mailpit'] });
		const api = app(s, 'api').env!;
		const password = localRolePassword(
			'compose-app',
			s.plan,
			'minio',
			'a-random-seed',
		);

		expect(s.infra).toEqual(['mailpit', 'minio', 'postgres']);
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
			allowDevServices: ['minio', 'mailpit'],
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
		expect(s.infra).toEqual(['minio', 'postgres']);
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

	it('allowing one dev service does not excuse the other', () => {
		const run = () => deployed({ allowDevServices: ['mailpit'] });

		expect(run).toThrow(ExternalServicesNotConfigured);
		expect(run).toThrow(/UPLOADS_URL/);
		expect(run).not.toThrow(/MAIL_URL/);
	});
});
