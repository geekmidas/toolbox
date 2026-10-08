import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { deployIdentity } from '../../deploy/identity';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import { TelemetryProviderRequired } from '../../telemetry/config';
import type {
	NormalizedWorkspace,
	StageTelemetryConfig,
} from '../../workspace/types';
import {
	isStrongLogsPassword,
	LogsPasswordMissing,
	LogsPasswordWeak,
	localTelemetryLogin,
	logsAccess,
	OPENOBSERVE_IMAGE,
	otlpHeaders,
	withLogsPassword,
} from '../logs';
import { LogsAllowEmpty, LogsAllowEntryInvalid } from '../logsConfig';
import { type ComposeStack, composeStack, type StackInput } from '../stack';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

/**
 * The stack's telemetry: a `Telemetry` construct the API, the auth server and
 * the worker are given, and — per stage — where `deploy.telemetry` sends it.
 */

interface Project {
	dir: string;
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	runnables: Record<string, string[]>;
	background: Record<string, string[]>;
}

/** Every process given the construct. */
let all: Project;
/** The API and the worker given it; the auth server not. */
let partial: Project;
/** No construct at all. */
let none: Project;

async function project(
	prefix: string,
	write: (dir: string) => void,
): Promise<Project> {
	const dir = realpathSync(await createTempDir(prefix));
	write(dir);
	return { dir, ...(await loadComposeApp(dir)) };
}

beforeAll(async () => {
	[all, partial, none] = await Promise.all([
		project('gkm-compose-telemetry-', (dir) =>
			writeComposeApp(dir, { telemetry: true }),
		),
		project('gkm-compose-telemetry-partial-', (dir) => {
			writeComposeApp(dir, { telemetry: true });
			const auth = join(dir, 'constructs', 'auth.ts');
			writeFileSync(
				auth,
				readFileSync(auth, 'utf-8').replace('\ttelemetry,\n', ''),
			);
		}),
		project('gkm-compose-no-telemetry-', (dir) => writeComposeApp(dir)),
	]);
}, 60_000);

afterAll(async () => {
	for (const p of [all, partial, none]) if (p) await cleanupDir(p.dir);
});

const PASSWORD = 'Generated-once-1';

function production(custom: Record<string, string> = {}): StageSecrets {
	return {
		...initStageSecrets('production'),
		seed: 'a-random-seed',
		custom: {
			AUTH_SECRET: 'the-production-signing-secret',
			ZO_ROOT_USER_PASSWORD: PASSWORD,
			REDIS_PASSWORD: 'the-redis-password',
			...custom,
		},
	};
}

function stack(
	options: {
		project?: Project;
		telemetry?: Record<string, StageTelemetryConfig>;
	} = {},
	overrides: Partial<StackInput> = {},
): ComposeStack {
	const { workspace, manifest, runnables, background } = options.project ?? all;
	const stage = overrides.stage ?? 'development';
	return composeStack({
		workspace: {
			...workspace,
			deploy: {
				...workspace.deploy,
				...(options.telemetry ? { telemetry: options.telemetry } : {}),
			},
		},
		manifest,
		runnables,
		background,
		stage,
		identity: deployIdentity(workspace, stage),
		images: { mode: 'build', tag: 'abc1234' },
		ports: { https: 8443, http: 8080 },
		...overrides,
	});
}

const deployed = (
	options: Parameters<typeof stack>[0] = {},
	custom: Record<string, string> = {},
) =>
	stack(options, {
		stage: 'production',
		images: { mode: 'pull', tag: 'v1.4.0' },
		secrets: production(custom),
		ports: {},
	});

/** A backend's or the worker's environment. */
const env = (s: ComposeStack, name: string) =>
	s.apps.find((app) => app.name === name)?.env ??
	s.workers.find((worker) => worker.name === name)?.env;
const buildArgs = (s: ComposeStack, name: string) =>
	s.apps.find((app) => app.name === name)!.build?.args ?? {};
const otel = (values: Record<string, string> | undefined) =>
	Object.fromEntries(
		Object.entries(values ?? {}).filter(([key]) => key.startsWith('OTEL_')),
	);

/** The login a Basic `OTEL_EXPORTER_OTLP_HEADERS` signs in with. */
function loginOf(headers: string | undefined): string {
	const [key, value] = (headers ?? '').split(/=(.*)/s);
	expect(key).toBe('Authorization');
	const header = decodeURIComponent(value!);
	expect(header).toMatch(/^Basic [A-Za-z0-9+/]+=*$/);
	return Buffer.from(header.slice(6), 'base64').toString();
}

describe('the local stage', () => {
	it('runs OpenObserve, pinned, published on loopback alone, when a process uses the construct', () => {
		const s = stack();
		const service = s.compose.services.openobserve!;

		expect(s.infra).toEqual(['openobserve', 'postgres', 'redis']);
		expect(service.image).toBe(OPENOBSERVE_IMAGE);
		expect(OPENOBSERVE_IMAGE).toMatch(/:v\d+\.\d+\.\d+$/);
		expect(service.restart).toBe('unless-stopped');
		expect(service.ports).toEqual(['127.0.0.1:5080:5080']);
		expect(service.volumes).toEqual(['openobserve-data:/data']);
		expect(s.compose.volumes).toHaveProperty('openobserve-data');
		expect(service.healthcheck?.test).toEqual([
			'CMD',
			'/openobserve',
			'node',
			'status',
		]);
		// Its root login is in a 0600 env file, not the compose file.
		expect(service.env_file).toEqual([
			{ path: './openobserve.env', format: 'raw' },
		]);
		expect(service.environment).toBeUndefined();
		expect(s.caddyfile).not.toContain('openobserve');
	});

	it('keeps 30 days, and signs in with the local login', () => {
		const s = stack();
		const login = localTelemetryLogin();

		expect(s.logs?.env).toEqual({
			ZO_ROOT_USER_EMAIL: login.email,
			ZO_ROOT_USER_PASSWORD: login.password,
			ZO_DATA_DIR: '/data',
			ZO_COMPACT_DATA_RETENTION_DAYS: '30',
			ZO_TELEMETRY: 'false',
		});
		expect(isStrongLogsPassword(login.password)).toBe(true);
		expect(s.logs?.url).toBe('http://localhost:5080');
	});

	it('points every process with the edge at it, at 100%, named for the process', () => {
		const s = stack();
		const login = localTelemetryLogin();

		for (const name of ['api', 'auth', 'jobs']) {
			const own = env(s, name)!;
			expect(otel(own)).toEqual({
				OTEL_EXPORTER_OTLP_ENDPOINT: 'http://openobserve:5080/api/default',
				OTEL_EXPORTER_OTLP_HEADERS: expect.any(String),
				OTEL_SERVICE_NAME: name,
				OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
				OTEL_TRACES_SAMPLER_ARG: '1',
			});
			expect(loginOf(own.OTEL_EXPORTER_OTLP_HEADERS)).toBe(
				`${login.email}:${login.password}`,
			);
		}
	});

	it('hands a site no server key: no environment, and no OTEL_* build arg', () => {
		const s = stack();

		expect(env(s, 'web')).toBeUndefined();
		expect(Object.keys(buildArgs(s, 'web'))).toEqual([
			'VITE_API_URL',
			'VITE_AUTH_URL',
		]);
		expect(JSON.stringify(s.compose.services.web)).not.toContain('OTEL_');
	});

	it('ignores deploy.telemetry', () => {
		for (const config of [
			false,
			{ provider: 'otlp', endpoint: 'https://otlp.example.com' },
			{ provider: 'self-hosted', sampleRate: 0.01, retentionDays: 3 },
		] as StageTelemetryConfig[]) {
			const s = stack({ telemetry: { development: config } });

			expect(s.infra).toContain('openobserve');
			expect(s.logs?.env.ZO_COMPACT_DATA_RETENTION_DAYS).toBe('30');
			expect(env(s, 'api')).toMatchObject({
				OTEL_EXPORTER_OTLP_ENDPOINT: 'http://openobserve:5080/api/default',
				OTEL_TRACES_SAMPLER_ARG: '1',
			});
		}
	});

	it('moves to the port GKM_COMPOSE_LOGS_PORT names', () => {
		const s = stack({}, { ports: { https: 8443, http: 8080, logs: 5099 } });

		expect(s.compose.services.openobserve?.ports).toEqual([
			'127.0.0.1:5099:5080',
		]);
		expect(s.logs?.url).toBe('http://localhost:5099');
		// Inside the stack it is still where it listens.
		expect(env(s, 'api')?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
			'http://openobserve:5080/api/default',
		);
	});

	it('is not waited on by the apps: an app whose telemetry fails still serves', () => {
		const s = stack();

		expect(Object.keys(s.compose.services.api?.depends_on ?? {})).toEqual([
			'postgres',
			'redis',
		]);
	});
});

describe('only the processes with an edge', () => {
	it('are handed the keys', () => {
		const s = stack({ project: partial });

		expect(otel(env(s, 'api'))).toHaveProperty('OTEL_SERVICE_NAME', 'api');
		expect(otel(env(s, 'jobs'))).toHaveProperty('OTEL_SERVICE_NAME', 'jobs');
		expect(otel(env(s, 'auth'))).toEqual({});
	});

	it('run it at all: no construct, no OpenObserve and no key, whatever the stage says', () => {
		for (const s of [
			stack({ project: none }),
			deployed({
				project: none,
				telemetry: { production: 'self-hosted' },
			}),
		]) {
			expect(s.infra).not.toContain('openobserve');
			expect(s.compose.services.openobserve).toBeUndefined();
			for (const name of ['api', 'auth', 'jobs']) {
				expect(otel(env(s, name))).toEqual({});
			}
		}
	});

	it("never pass the stage's own OTEL_* secrets through", () => {
		const s = deployed(
			{ project: none },
			{
				OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
				OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=hosted-key',
			},
		);

		for (const name of ['api', 'auth', 'jobs']) {
			expect(otel(env(s, name))).toEqual({});
		}
	});
});

describe('a deployed stage', () => {
	it('runs the self-hosted provider when it names nothing, signed in with its generated password', () => {
		const s = deployed();

		expect(s.infra).toContain('openobserve');
		expect(s.logs?.email).toBe('admin@shop.example.com');
		expect(s.logs?.env.ZO_ROOT_USER_PASSWORD).toBe(PASSWORD);
		expect(loginOf(env(s, 'api')?.OTEL_EXPORTER_OTLP_HEADERS)).toBe(
			`admin@shop.example.com:${PASSWORD}`,
		);
		expect(env(s, 'api')?.OTEL_TRACES_SAMPLER_ARG).toBe('1');
	});

	it('samples at the rate the stage sets, for every process with the edge', () => {
		const s = deployed({
			telemetry: {
				production: {
					provider: 'self-hosted',
					sampleRate: 0.1,
					port: 5081,
					retentionDays: 14,
				},
			},
		});

		for (const name of ['api', 'auth', 'jobs']) {
			expect(env(s, name)).toMatchObject({
				OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
				OTEL_TRACES_SAMPLER_ARG: '0.1',
			});
		}
		expect(s.compose.services.openobserve?.ports).toEqual([
			'127.0.0.1:5081:5080',
		]);
		expect(s.logs?.env.ZO_COMPACT_DATA_RETENTION_DAYS).toBe('14');
	});

	it('sends to an OTLP endpoint, with its headers, and runs no OpenObserve', () => {
		const s = deployed({
			telemetry: {
				production: {
					provider: 'otlp',
					endpoint: 'https://otlp.example.com',
					headers: { 'x-api-key': 'hosted key' },
					sampleRate: 0.5,
				},
			},
		});

		expect(s.infra).not.toContain('openobserve');
		expect(s.logs).toBeUndefined();
		for (const name of ['api', 'auth', 'jobs']) {
			expect(otel(env(s, name))).toEqual({
				OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
				OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=hosted%20key',
				OTEL_SERVICE_NAME: name,
				OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
				OTEL_TRACES_SAMPLER_ARG: '0.5',
			});
		}
		expect(env(s, 'web')).toBeUndefined();
	});

	it('sends nothing when it opts out with false', () => {
		const s = deployed({ telemetry: { production: false } });

		expect(s.infra).not.toContain('openobserve');
		for (const name of ['api', 'auth', 'jobs']) {
			expect(otel(env(s, name))).toEqual({});
		}
	});

	it("takes the root login the stage's secrets set", () => {
		const s = deployed(
			{},
			{
				ZO_ROOT_USER_EMAIL: 'ops@example.com',
				ZO_ROOT_USER_PASSWORD: 'Chosen-by-hand-2',
			},
		);

		expect(s.logs?.env).toMatchObject({
			ZO_ROOT_USER_EMAIL: 'ops@example.com',
			ZO_ROOT_USER_PASSWORD: 'Chosen-by-hand-2',
		});
	});

	it('refuses a stage whose secrets have no root password yet', () => {
		expect(() =>
			stack(
				{},
				{
					stage: 'production',
					images: { mode: 'pull', tag: 'v1.4.0' },
					secrets: {
						...production(),
						custom: { AUTH_SECRET: 'the-production-signing-secret' },
					},
				},
			),
		).toThrow(LogsPasswordMissing);
	});

	it('refuses a password OpenObserve would refuse to start with', () => {
		expect(() => deployed({}, { ZO_ROOT_USER_PASSWORD: 'password' })).toThrow(
			LogsPasswordWeak,
		);
	});

	it('never asks AWS’s question of the compose target: it always runs self-hosted', () => {
		expect(() => deployed()).not.toThrow(TelemetryProviderRequired);
	});
});

describe('served publicly', () => {
	const allow = ['203.0.113.7', '10.0.0.0/8'];
	const publicly = (list: string[]) =>
		deployed({
			telemetry: {
				production: { provider: 'self-hosted', public: { allow: list } },
			},
		});

	it('answers on logs.<stage domain>, to the listed addresses alone, with no host port', () => {
		const s = publicly(allow);
		const site = s.caddyfile.slice(
			s.caddyfile.indexOf('https://logs.shop.example.com {'),
		);

		expect(s.compose.services.openobserve?.ports).toBeUndefined();
		expect(site).toMatch(/^https:\/\/logs\.shop\.example\.com \{\n\t# Only/);
		expect(site).toContain('@denied not remote_ip 203.0.113.7 10.0.0.0/8');
		expect(site).toContain('respond @denied 403');
		expect(site).toContain('reverse_proxy openobserve:5080');
		expect(s.logs?.url).toBe('https://logs.shop.example.com');
		// No other host is gated.
		expect(s.caddyfile.match(/remote_ip/g)).toHaveLength(1);
	});

	it('refuses an empty allow list, and an entry that is not an address or a range', () => {
		expect(() => publicly([])).toThrow(LogsAllowEmpty);
		expect(() => publicly(['office'])).toThrow(LogsAllowEntryInvalid);
		expect(() => publicly(['10.0.0.0/33'])).toThrow(LogsAllowEntryInvalid);
		expect(() => publicly(['2001:db8::/32', '::1'])).not.toThrow();
	});
});

describe('the root password', () => {
	it('is generated once, meeting OpenObserve’s rules, and kept after', () => {
		const first = withLogsPassword(initStageSecrets('production'));
		const password = first.secrets.custom.ZO_ROOT_USER_PASSWORD!;

		expect(first.generated).toEqual(['ZO_ROOT_USER_PASSWORD']);
		expect(isStrongLogsPassword(password)).toBe(true);

		const again = withLogsPassword(first.secrets);
		expect(again.generated).toEqual([]);
		expect(again.secrets.custom.ZO_ROOT_USER_PASSWORD).toBe(password);
	});

	it('is encoded into the header for any root login', () => {
		expect(otlpHeaders('a@b.c', 'p:w/+=')).toBe(
			`Authorization=Basic%20${Buffer.from('a@b.c:p:w/+=').toString('base64')}`,
		);
	});
});

describe('how to open it', () => {
	const ctx = {
		stage: 'production',
		local: false,
		user: 'deploy',
		hostname: 'box-1',
	};

	it('prints the SSH tunnel and the ufw warning by default', () => {
		const lines = logsAccess(deployed().logs!, ctx);

		expect(lines).toEqual([
			'📜 Logs (OpenObserve) on 127.0.0.1:5080 — from your computer:',
			"     ssh -N -L 5080:localhost:5080 deploy@box-1   (user and host are guesses: this machine's)",
			'     then open http://localhost:5080  (login: admin@shop.example.com, password: gkm secrets:show --stage production --reveal → ZO_ROOT_USER_PASSWORD)',
			'⚠️  Docker-published ports bypass ufw, so OpenObserve is bound to 127.0.0.1 only — reach it through the tunnel, not by opening the port.',
		]);
	});

	it('prints the public URL and who may reach it', () => {
		const lines = logsAccess(
			deployed({
				telemetry: {
					production: {
						provider: 'self-hosted',
						public: { allow: ['203.0.113.7'] },
					},
				},
			}).logs!,
			ctx,
		);

		expect(lines[0]).toContain('https://logs.shop.example.com');
		expect(lines[1]).toContain('203.0.113.7');
	});

	it('says the local stage opens directly, with its login', () => {
		const login = localTelemetryLogin();
		const lines = logsAccess(stack().logs!, {
			...ctx,
			stage: 'development',
			local: true,
		});

		expect(lines[1]).toBe(
			'     on this machine, open http://localhost:5080 directly; from another:',
		);
		expect(lines[3]).toContain(
			`(login: ${login.email}, password: ${login.password})`,
		);
	});
});
