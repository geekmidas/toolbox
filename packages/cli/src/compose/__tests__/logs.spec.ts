import { realpathSync } from 'node:fs';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { generateLocalCredentials } from '../../reconcile/localCredentials';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import {
	formatValidationErrors,
	safeValidateWorkspaceConfig,
} from '../../workspace/schema';
import type {
	ComposeLogsConfig,
	NormalizedWorkspace,
} from '../../workspace/types';
import {
	isStrongLogsPassword,
	LOCAL_LOGS_EMAIL,
	LogsEndpointConflict,
	LogsPasswordMissing,
	LogsPasswordWeak,
	logsAccess,
	OPENOBSERVE_IMAGE,
	otlpHeaders,
	withLogsPassword,
} from '../logs';
import {
	LogsAllowEmpty,
	LogsAllowEntryInvalid,
	LogsPortInvalid,
	LogsRetentionInvalid,
} from '../logsConfig';
import { type ComposeStack, composeStack, type StackInput } from '../stack';

/** This machine's generated root password for the local stage's logs. */
const LOCAL_LOGS_PASSWORD = TEST_CREDENTIALS.logs.password;

import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-logs-'));
	writeComposeApp(dir);
	({ workspace, manifest, runnables } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
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
	logs: boolean | ComposeLogsConfig | undefined,
	overrides: Partial<StackInput> = {},
): ComposeStack {
	const stage = overrides.stage ?? 'development';
	return composeStack({
		workspace: {
			...workspace,
			deploy: {
				...workspace.deploy,
				...(logs !== undefined ? { compose: { logs } } : {}),
			},
		},
		manifest,
		runnables,
		stage,
		identity: deployIdentity(workspace, stage),
		images: { mode: 'build', tag: 'abc1234' },
		ports: { https: 8443, http: 8080 },
		localCredentials: TEST_CREDENTIALS,
		...overrides,
	});
}

const deployed = (
	logs: boolean | ComposeLogsConfig | undefined,
	custom: Record<string, string> = {},
) =>
	stack(logs, {
		stage: 'production',
		images: { mode: 'pull', tag: 'v1.4.0' },
		secrets: production(custom),
		ports: {},
	});

const env = (s: ComposeStack, name: string) =>
	s.apps.find((app) => app.name === name)!.env;
const buildArgs = (s: ComposeStack, name: string) =>
	s.apps.find((app) => app.name === name)!.build?.args ?? {};

/** What a stage that sends its telemetry to a hosted backend sets. */
const HOSTED = {
	OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
	OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=hosted-key',
	OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
	OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://logs.example.com/v1/logs',
	OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-traces=1',
	OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'grpc',
	OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
	OTEL_TRACES_SAMPLER_ARG: '0.1',
	OTEL_RESOURCE_ATTRIBUTES: 'team=shop',
};

describe("the stage's OTEL_* variables", () => {
	it('reach every backend, named after the app, and no site', () => {
		const s = deployed(undefined, {
			...HOSTED,
			// Not one the servers read: never forwarded.
			OTEL_LOG_LEVEL: 'debug',
		});

		for (const name of ['api', 'auth']) {
			expect(env(s, name)).toMatchObject({
				...HOSTED,
				OTEL_SERVICE_NAME: name,
			});
			expect(env(s, name)).not.toHaveProperty('OTEL_LOG_LEVEL');
		}
		// The site's container gets no environment, and its bundle no OTEL_*.
		expect(env(s, 'web')).toBeUndefined();
		expect(JSON.stringify(s.compose.services.web)).not.toContain('OTEL_');
	});

	it("keeps the stage's own service name", () => {
		const s = deployed(undefined, {
			OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
			OTEL_SERVICE_NAME: 'shop',
		});

		expect(env(s, 'api')?.OTEL_SERVICE_NAME).toBe('shop');
	});

	it('adds nothing to a stage that sets none', () => {
		const s = deployed(undefined);

		expect(
			Object.keys(env(s, 'api')!).filter((key) => key.startsWith('OTEL_')),
		).toEqual([]);
	});

	it('reach a site built from this checkout in no build arg', () => {
		const s = stack(undefined, {
			secrets: { ...initStageSecrets('development'), custom: HOSTED },
		});

		expect(env(s, 'api')?.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
			HOSTED.OTEL_EXPORTER_OTLP_ENDPOINT,
		);
		expect(Object.keys(buildArgs(s, 'web'))).toEqual([
			'VITE_API_URL',
			'VITE_AUTH_URL',
		]);
	});
});

describe('logs: true', () => {
	it('runs OpenObserve, pinned, published on loopback alone', () => {
		const s = stack(true);
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
	});

	it('gives it no host on the edge', () => {
		const s = stack(true);

		expect(s.caddyfile).not.toContain('openobserve');
		expect(s.caddyfile).not.toContain('logs.');
	});

	it('generates a root password OpenObserve accepts, every time', () => {
		for (let i = 0; i < 50; i++) {
			expect(
				isStrongLogsPassword(generateLocalCredentials('shop').logs.password),
			).toBe(true);
		}
	});

	it("keeps 30 days, and the local stage signs in with this machine's generated login", () => {
		const s = stack(true);

		expect(s.logs?.env).toEqual({
			ZO_ROOT_USER_EMAIL: LOCAL_LOGS_EMAIL,
			ZO_ROOT_USER_PASSWORD: LOCAL_LOGS_PASSWORD,
			ZO_DATA_DIR: '/data',
			ZO_COMPACT_DATA_RETENTION_DAYS: '30',
			ZO_TELEMETRY: 'false',
		});
		expect(isStrongLogsPassword(LOCAL_LOGS_PASSWORD)).toBe(true);
		expect(s.logs?.url).toBe('http://localhost:5080');
	});

	it('takes another port and retention', () => {
		const s = stack({ port: 5099, retentionDays: 14 });

		expect(s.compose.services.openobserve?.ports).toEqual([
			'127.0.0.1:5099:5080',
		]);
		expect(s.logs?.env.ZO_COMPACT_DATA_RETENTION_DAYS).toBe('14');
	});

	it('points every backend at it, signed in as its root user, and no site', () => {
		const s = stack(true);

		for (const name of ['api', 'auth']) {
			const own = env(s, name)!;
			expect(own.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
				'http://openobserve:5080/api/default',
			);
			expect(own.OTEL_SERVICE_NAME).toBe(name);

			// `Authorization=Basic%20<base64>`: the SDK percent-decodes the value.
			const [key, value] = own.OTEL_EXPORTER_OTLP_HEADERS!.split(/=(.*)/s);
			expect(key).toBe('Authorization');
			const header = decodeURIComponent(value!);
			expect(header).toMatch(/^Basic [A-Za-z0-9+/]+=*$/);
			expect(Buffer.from(header.slice(6), 'base64').toString()).toBe(
				`${LOCAL_LOGS_EMAIL}:${LOCAL_LOGS_PASSWORD}`,
			);
		}
		expect(env(s, 'web')).toBeUndefined();
		expect(Object.keys(buildArgs(s, 'web'))).not.toContain(
			'OTEL_EXPORTER_OTLP_ENDPOINT',
		);
	});

	it('keeps the stage sampling settings beside it', () => {
		const s = stack(true, {
			secrets: {
				...initStageSecrets('development'),
				custom: { OTEL_TRACES_SAMPLER: 'always_on' },
			},
		});

		expect(env(s, 'api')?.OTEL_TRACES_SAMPLER).toBe('always_on');
	});

	it('is not waited on by the apps: an app whose telemetry fails still serves', () => {
		const s = stack(true);

		expect(Object.keys(s.compose.services.api?.depends_on ?? {})).toEqual([
			'postgres',
			'redis',
		]);
	});

	it('encodes the header for any root login', () => {
		expect(otlpHeaders('a@b.c', 'p:w/+=')).toBe(
			`Authorization=Basic%20${Buffer.from('a@b.c:p:w/+=').toString('base64')}`,
		);
	});
});

describe('logs on a deployed stage', () => {
	it("signs in as admin@<stage domain> with the stage's generated password", () => {
		const s = deployed(true);

		expect(s.logs?.email).toBe('admin@shop.example.com');
		expect(s.logs?.env.ZO_ROOT_USER_PASSWORD).toBe(PASSWORD);
		expect(
			Buffer.from(
				decodeURIComponent(
					env(s, 'api')!
						.OTEL_EXPORTER_OTLP_HEADERS!.split('=')
						.slice(1)
						.join('='),
				).slice(6),
				'base64',
			).toString(),
		).toBe(`admin@shop.example.com:${PASSWORD}`);
	});

	it("takes the root login the stage's secrets set", () => {
		const s = deployed(true, {
			ZO_ROOT_USER_EMAIL: 'ops@example.com',
			ZO_ROOT_USER_PASSWORD: 'Chosen-by-hand-2',
		});

		expect(s.logs?.env).toMatchObject({
			ZO_ROOT_USER_EMAIL: 'ops@example.com',
			ZO_ROOT_USER_PASSWORD: 'Chosen-by-hand-2',
		});
	});

	it('refuses a stage whose secrets have no root password yet', () => {
		expect(() =>
			stack(true, {
				stage: 'production',
				images: { mode: 'pull', tag: 'v1.4.0' },
				secrets: {
					...production(),
					custom: { AUTH_SECRET: 'the-production-signing-secret' },
				},
			}),
		).toThrow(LogsPasswordMissing);
	});

	it('refuses a password OpenObserve would refuse to start with', () => {
		expect(() => deployed(true, { ZO_ROOT_USER_PASSWORD: 'password' })).toThrow(
			LogsPasswordWeak,
		);
	});

	it('refuses a stage that already sends its telemetry elsewhere', () => {
		const run = () =>
			deployed(true, {
				OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
			});

		expect(run).toThrow(LogsEndpointConflict);
		expect(run).toThrow(/remove logs from deploy\.compose/);
		expect(run).toThrow(/remove OTEL_EXPORTER_OTLP_ENDPOINT from the stage/);
	});

	it('refuses a per-signal endpoint as well', () => {
		expect(() =>
			deployed(true, {
				OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://logs.example.com',
			}),
		).toThrow(LogsEndpointConflict);
	});
});

describe('logs served publicly', () => {
	const allow = ['203.0.113.7', '10.0.0.0/8'];

	it('is a host on the edge that refuses every other address, and no host port', () => {
		const s = stack({ public: { allow } });

		expect(s.compose.services.openobserve?.ports).toBeUndefined();
		expect(s.caddyfile).toContain(`https://logs.compose-app.localhost {
	tls internal

	# Only these addresses`);
		expect(s.caddyfile).toContain(
			'@denied not remote_ip 203.0.113.7 10.0.0.0/8',
		);
		expect(s.caddyfile).toContain('respond @denied 403');
		expect(s.caddyfile).toContain('reverse_proxy openobserve:5080');
		expect(s.logs?.url).toBe('https://logs.compose-app.localhost:8443');
	});

	it("answers on logs.<stage domain> for a deployed stage, with ACME's certificate", () => {
		const s = deployed({ public: { allow } });
		const site = s.caddyfile.slice(
			s.caddyfile.indexOf('https://logs.shop.example.com {'),
		);

		expect(site).toMatch(/^https:\/\/logs\.shop\.example\.com \{\n\t# Only/);
		expect(site).toContain('respond @denied 403');
		expect(s.logs?.url).toBe('https://logs.shop.example.com');
		// No other host is gated.
		expect(s.caddyfile.match(/remote_ip/g)).toHaveLength(1);
	});

	it('refuses an empty allow list', () => {
		expect(() => stack({ public: { allow: [] } })).toThrow(LogsAllowEmpty);
	});

	it('refuses an entry that is not an address or a range', () => {
		expect(() => stack({ public: { allow: ['office'] } })).toThrow(
			LogsAllowEntryInvalid,
		);
		expect(() => stack({ public: { allow: ['10.0.0.0/33'] } })).toThrow(
			LogsAllowEntryInvalid,
		);
		expect(() =>
			stack({ public: { allow: ['2001:db8::/32', '::1'] } }),
		).not.toThrow();
	});
});

describe('deploy.compose.logs in gkm.config.ts', () => {
	const validate = (logs: unknown) => {
		const result = safeValidateWorkspaceConfig({
			name: 'shop',
			stages: { local: 'development', deployed: ['production'] },
			apps: { api: { type: 'backend', path: 'apps/api', port: 3000 } },
			deploy: { compose: { logs } },
		});
		return result.error ? formatValidationErrors(result.error) : 'valid';
	};

	it('takes true, or ports, retention and an allow list', () => {
		expect(validate(true)).toBe('valid');
		expect(validate(false)).toBe('valid');
		expect(
			validate({
				port: 5081,
				retentionDays: 7,
				public: { allow: ['203.0.113.7'] },
			}),
		).toBe('valid');
	});

	it('refuses, with the named error, what OpenObserve or Caddy could not use', () => {
		expect(validate({ public: { allow: [] } })).toContain(
			new LogsAllowEmpty().message,
		);
		expect(validate({ retentionDays: 2 })).toContain(
			new LogsRetentionInvalid(2).message,
		);
		expect(validate({ retentionDays: 1.5 })).toContain('whole number of days');
		expect(validate({ port: 70000 })).toContain(
			new LogsPortInvalid(70000).message,
		);
		expect(validate({ public: {} })).not.toBe('valid');
	});

	it('refuses the same configs when the stack reads them', () => {
		expect(() => stack({ retentionDays: 0 })).toThrow(LogsRetentionInvalid);
		expect(() => stack({ port: 0 })).toThrow(LogsPortInvalid);
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
});

describe('how to open it', () => {
	const ctx = {
		stage: 'production',
		local: false,
		user: 'deploy',
		hostname: 'box-1',
	};

	it('prints the SSH tunnel and the ufw warning by default', () => {
		const lines = logsAccess(deployed(true).logs!, ctx);

		expect(lines).toEqual([
			'📜 Logs (OpenObserve) on 127.0.0.1:5080 — from your computer:',
			"     ssh -N -L 5080:localhost:5080 deploy@box-1   (user and host are guesses: this machine's)",
			'     then open http://localhost:5080  (login: admin@shop.example.com, password: gkm secrets:show --stage production --reveal → ZO_ROOT_USER_PASSWORD)',
			'⚠️  Docker-published ports bypass ufw, so OpenObserve is bound to 127.0.0.1 only — reach it through the tunnel, not by opening the port.',
		]);
	});

	it('prints the public URL and who may reach it', () => {
		const lines = logsAccess(
			deployed({ public: { allow: ['203.0.113.7'] } }).logs!,
			ctx,
		);

		expect(lines[0]).toContain('https://logs.shop.example.com');
		expect(lines[1]).toContain('203.0.113.7');
	});

	it('says the local stage opens directly, with its generated login', () => {
		const lines = logsAccess(stack(true).logs!, {
			...ctx,
			stage: 'development',
			local: true,
		});

		expect(lines[1]).toBe(
			'     on this machine, open http://localhost:5080 directly; from another:',
		);
		expect(lines[3]).toContain(
			`(login: ${LOCAL_LOGS_EMAIL}, password: ${LOCAL_LOGS_PASSWORD})`,
		);
	});
});
