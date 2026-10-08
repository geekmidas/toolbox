import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	type ConstructManifest,
	publicEnvFor,
	TELEMETRY_KEYS,
} from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { localTelemetryLogin, OPENOBSERVE_IMAGE } from '../../compose/logs';
import { appTelemetry, scopeTelemetryEnv } from '../../telemetry/edges';
import { appEnvKeys } from '../apps';
import type { Docker } from '../index';
import { COMPOSE_PATH, reconcile } from '../index';

/**
 * `gkm dev`'s side of telemetry: reconcile runs OpenObserve when a process
 * uses a `Telemetry` node, resolves the local `OTEL_*` keys, and those keys
 * follow the node's edges — to the processes that have one, never to a site.
 */

const TELEMETRY = {
	kind: 'telemetry',
	id: 'Telemetry',
	provides: [...TELEMETRY_KEYS],
} as const;

/** An API and a worker with the edge, an auth server without, and a site with. */
const used = {
	Telemetry: TELEMETRY,
	Database: { kind: 'database', id: 'Database', provides: ['DATABASE_URL'] },
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [],
		telemetry: 'Telemetry',
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
	},
	Auth: {
		kind: 'rest-api',
		id: 'Auth',
		path: 'apps/auth',
		provides: ['AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'AUTH_COOKIE_DOMAIN'],
		endpoints: [
			{
				id: 'AuthHandler',
				handler: 'Auth.handler',
				method: 'ANY',
				path: '/api/auth/*',
				dependencies: [{ target: 'Database', kind: 'database' }],
			},
		],
	},
	Jobs: {
		kind: 'worker',
		id: 'Jobs',
		telemetry: 'Telemetry',
		dependencies: [{ target: 'Database', kind: 'database' }],
		provides: [],
	},
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'next',
		app: { path: 'apps/web' },
		telemetry: 'Telemetry',
		dependencies: [{ target: 'Api', kind: 'rest-api' }],
		provides: ['WEB_URL'],
	},
} as unknown as ConstructManifest;

/** The node declared, and nothing given it. */
const unused = {
	Telemetry: TELEMETRY,
	Database: used.Database,
	Auth: used.Auth,
} as unknown as ConstructManifest;

function fakeDocker() {
	const up: string[][] = [];
	const docker: Docker = {
		async publishedPort() {
			return undefined;
		},
		async up(_path, services) {
			up.push([...services]);
		},
		async healthy() {
			return false;
		},
		async copyOut() {},
		async reload() {},
	};
	return { docker, up };
}

describe('reconcile, with a Telemetry construct', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-reconcile-telemetry-'));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const run = (
		manifest: ConstructManifest,
		stage = 'development',
		docker = fakeDocker().docker,
	) =>
		reconcile({
			root,
			project: 'shop',
			manifest,
			stage,
			localStage: 'development',
			docker,
			edge: false,
			probe: async () => true,
			sql: () => ({ query: async () => [] }),
		});

	it('adds OpenObserve to the dev services when a process uses the node', async () => {
		const { docker, up } = fakeDocker();
		const result = await run(used, 'development', docker);

		expect(result.plan.containers).toContain('openobserve');
		expect(up[0]).toContain('openobserve');

		const compose = parse(await readFile(join(root, COMPOSE_PATH), 'utf-8'));
		const login = localTelemetryLogin();
		expect(compose.services.openobserve).toMatchObject({
			image: OPENOBSERVE_IMAGE,
			environment: {
				ZO_ROOT_USER_EMAIL: login.email,
				ZO_ROOT_USER_PASSWORD: login.password,
				ZO_DATA_DIR: '/data',
			},
			volumes: ['openobserve-data:/data'],
		});
		expect(compose.volumes).toHaveProperty('openobserve-data');

		// Listed with the other dev services, as a page to open.
		const ui = result.services.find((s) => s.container === 'openobserve');
		expect(ui?.address).toMatch(/^http:\/\/localhost:\d+$/);
	});

	it('adds nothing when the node is declared and no process uses it', async () => {
		const result = await run(unused);

		expect(result.plan.containers).not.toContain('openobserve');
		expect(
			Object.keys(result.env).filter((key) => key.startsWith('OTEL_')),
		).toEqual([]);
	});

	it('resolves the local keys: OpenObserve’s ingest, its login, and every trace', async () => {
		const result = await run(used);
		const port = result.ports.openobserve;
		const login = localTelemetryLogin();

		expect(result.env).toMatchObject({
			OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${port}/api/default`,
			OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
			OTEL_TRACES_SAMPLER_ARG: '1',
		});
		expect(
			Buffer.from(
				decodeURIComponent(
					result.env.OTEL_EXPORTER_OTLP_HEADERS!.split(/=(.*)/s)[1]!,
				).slice(6),
				'base64',
			).toString(),
		).toBe(`${login.email}:${login.password}`);
		// Named per process, never for the stage.
		expect(result.env).not.toHaveProperty('OTEL_SERVICE_NAME');
	});

	it('starts no collector and hands out no key for `gkm test`, and keeps the container in the file', async () => {
		const { docker, up } = fakeDocker();
		const result = await run(used, 'test', docker);

		expect(up[0]).not.toContain('openobserve');
		expect(
			Object.keys(result.env).filter((key) => key.startsWith('OTEL_')),
		).toEqual([]);
		// The file `gkm dev` runs from too: dropping the service would have
		// `up --remove-orphans` stop the one dev exports to.
		const compose = parse(await readFile(join(root, COMPOSE_PATH), 'utf-8'));
		expect(compose.services).toHaveProperty('openobserve');
	});
});

describe('the keys follow the edges', () => {
	it('to each process with one — the API, the worker its server runs', () => {
		for (const key of TELEMETRY_KEYS) {
			expect(appEnvKeys(used, 'api')).toContain(key);
		}
		expect(appTelemetry(used, 'api')?.id).toBe('Telemetry');
	});

	it('to no process without one', () => {
		for (const key of TELEMETRY_KEYS) {
			expect(appEnvKeys(used, 'auth')).not.toContain(key);
		}
		expect(appTelemetry(used, 'auth')).toBeUndefined();
	});

	it('to no site: not its environment, and never its public values', () => {
		const keys = appEnvKeys(used, 'web')!;
		for (const key of TELEMETRY_KEYS) expect(keys).not.toContain(key);

		const inlined = publicEnvFor(used.Web as never, used);
		expect(Object.keys(inlined)).toEqual(['NEXT_PUBLIC_API_URL']);
		for (const [name, source] of Object.entries(inlined)) {
			expect(`${name} ${source}`).not.toMatch(/OTEL_/);
		}
	});

	it('named for the process, or not at all', () => {
		const stage = {
			OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:5080/api/default',
			OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
			OTEL_TRACES_SAMPLER_ARG: '1',
		};

		expect(
			scopeTelemetryEnv(
				{ DATABASE_URL: 'postgres://…' },
				{ uses: true, serviceName: 'api', telemetry: stage },
			),
		).toEqual({
			DATABASE_URL: 'postgres://…',
			...stage,
			OTEL_SERVICE_NAME: 'api',
		});
		expect(
			scopeTelemetryEnv(
				{ DATABASE_URL: 'postgres://…', ...stage },
				{ uses: false, serviceName: 'auth', telemetry: stage },
			),
		).toEqual({ DATABASE_URL: 'postgres://…' });
	});
});
