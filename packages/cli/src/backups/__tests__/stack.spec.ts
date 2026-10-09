import { realpathSync } from 'node:fs';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import {
	type ComposeStack,
	composeStack,
	stackPlan,
} from '../../compose/stack';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import type { NormalizedWorkspace } from '../../workspace/types';
import { checkStageBackups, type StageBackups } from '../schedule';
import {
	BACKUPS_SERVICE,
	BackupsUrlMissing,
	backupsDockerfile,
	backupsRoleStatements,
	backupsService,
	runnerSource,
	stackBackups,
} from '../service';

const BACKUPS_URL =
	's3://AKIABACKUPS:s3cr3t%2Fkey@gkm-compose-app-000000000000?region=eu-west-1';

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;
let background: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-backups-stack-'));
	writeComposeApp(dir, {
		registry: 'registry.example.com/acme',
		target: 'compose',
		deployed: ['production', 'staging'],
		domains: { production: 'shop.example.com', staging: 'staging.example.com' },
		deployBackups: { staging: false },
	});
	({ workspace, manifest, runnables, background } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
});

function secrets(
	stage: string,
	custom: Record<string, string> = { BACKUPS_URL },
): StageSecrets {
	return {
		...initStageSecrets(stage),
		seed: 'a-random-seed',
		custom: {
			AUTH_SECRET: 'the-signing-secret',
			REDIS_PASSWORD: 'the-redis-password',
			...custom,
		},
	};
}

function stack(
	stage: string,
	stageSecrets: StageSecrets = secrets(stage),
	options: { buildOnly?: boolean } = {},
): ComposeStack {
	return composeStack({
		workspace,
		manifest,
		runnables,
		background,
		stage,
		identity: deployIdentity(workspace, stage),
		images: { mode: 'pull', tag: 'v1' },
		secrets: stageSecrets,
		localCredentials: TEST_CREDENTIALS,
		...(options.buildOnly ? { buildOnly: true } : {}),
	});
}

describe("a deployed compose stage's stack", () => {
	it('runs a backups service built from its own Postgres, reading its key from its env file, with no host mount', () => {
		const s = stack('production');
		const service = s.compose.services[BACKUPS_SERVICE];

		expect(service).toMatchObject({
			image: expect.stringMatching(
				/^compose-app-production-backups:pg18-[0-9a-f]{12}$/,
			),
			build: { context: './backups', dockerfile: 'Dockerfile' },
			pull_policy: 'build',
			restart: 'unless-stopped',
			env_file: [{ path: './backups.env', format: 'raw' }],
			depends_on: { postgres: { condition: 'service_healthy' } },
			healthcheck: {
				test: ['CMD', 'node', '/gkm/backup.mjs', 'health'],
			},
		});
		expect(service?.volumes).toBeUndefined();
		expect(service?.ports).toBeUndefined();
		expect(service?.networks).toBeUndefined();

		expect(s.backups?.files.Dockerfile).toContain('FROM postgres:18-alpine');
		expect(s.backups?.files.Dockerfile).toContain('apk add --no-cache nodejs');
		// The runner, as JavaScript: no type is left in it.
		expect(s.backups?.files['backup.mjs']).toContain('function backupOnce');
		expect(s.backups?.files['backup.mjs']).not.toMatch(/: Promise<boolean>/);
	});

	it("hands it the stage's key, its own read-only login, and every database by its file", () => {
		const { backups } = stack('production');

		expect(backups?.env).toMatchObject({
			BACKUPS_URL,
			BACKUPS_PREFIX: 'gkm/compose-app/production/backups',
			BACKUPS_SCHEDULE: JSON.stringify({
				kind: 'every',
				seconds: 86_400,
				offset: 7_200,
			}),
			BACKUPS_MAX_GAP_SECONDS: '86400',
			PGHOST: 'postgres',
			PGPORT: '5432',
			PGUSER: 'compose_app_backups',
		});
		expect(JSON.parse(backups!.env.BACKUPS_DATABASES!)).toEqual([
			{ file: 'database', name: 'database_production' },
		]);
		expect(backups?.readOnly).toBe(true);
		expect(backups?.env.PGPASSWORD).toBe(backups?.login.password);
		expect(backups?.login.password).not.toBe(
			stack('production').credential.containers.postgres.password,
		);

		const sql = backupsRoleStatements(backups!).map((s) => s.create);
		expect(sql).toEqual([
			expect.stringMatching(
				/^CREATE ROLE "compose_app_backups" LOGIN PASSWORD '/,
			),
			expect.stringMatching(
				/^ALTER ROLE "compose_app_backups" WITH LOGIN PASSWORD '/,
			),
			'GRANT pg_read_all_data TO "compose_app_backups"',
		]);
	});

	it('refuses to start without the key the deploy writes, naming it', () => {
		expect(() => stack('production', secrets('production', {}))).toThrow(
			BackupsUrlMissing,
		);
	});

	it('runs none where deploy.backups.<stage> is false', () => {
		const s = stack('staging', secrets('staging', {}));
		expect(s.compose.services[BACKUPS_SERVICE]).toBeUndefined();
		expect(s.backups).toBeUndefined();
	});

	it('runs none on the local stage, nor in a stack that only builds', () => {
		expect(
			stack('development').compose.services[BACKUPS_SERVICE],
		).toBeUndefined();
		expect(
			stack('production', secrets('production', {}), { buildOnly: true })
				.compose.services[BACKUPS_SERVICE],
		).toBeUndefined();
	});
});

describe('the backups service, from its parts', () => {
	const input = (parts: Partial<Parameters<typeof stackBackups>[0]> = {}) =>
		stackBackups({
			workspace,
			stage: 'production',
			project: 'compose-app-production',
			plan: stackPlan(workspace, manifest, 'production'),
			backups: checkStageBackups('production', {}) as StageBackups,
			custom: { BACKUPS_URL },
			seed: 'a-random-seed',
			superuser: { user: 'compose_app_admin', password: 'the-admin-password' },
			...parts,
		});

	it('signs in as the superuser on a Postgres before pg_read_all_data, and creates no role', () => {
		const old = {
			...manifest,
			Database: { ...manifest.Database, version: 13 },
		} as ConstructManifest;
		const backups = input({ plan: stackPlan(workspace, old, 'production') });
		expect(backups.from).toBe('postgres:13-alpine');
		expect(backups.image).toMatch(/:pg13-/);
		expect(backups.readOnly).toBe(false);
		expect(backups.env).toMatchObject({
			PGUSER: 'compose_app_admin',
			PGPASSWORD: 'the-admin-password',
		});
		expect(backupsRoleStatements(backups)).toEqual([]);
	});

	it("hands a cron schedule expanded, and the stage's telemetry when it is on", () => {
		const backups = input({
			backups: checkStageBackups('production', {
				cron: '15 3 * * 1',
			}) as StageBackups,
			telemetry: {
				OTEL_EXPORTER_OTLP_ENDPOINT: 'http://openobserve:5080/api/default',
				OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic abc',
				OTEL_TRACES_SAMPLER_ARG: '1',
			},
		});
		expect(JSON.parse(backups.env.BACKUPS_SCHEDULE!)).toEqual({
			kind: 'cron',
			minutes: [15],
			hours: [3],
			days: null,
			months: null,
			weekdays: [1],
		});
		expect(backups.env.BACKUPS_MAX_GAP_SECONDS).toBe(String(7 * 86_400));
		expect(backups.env).toMatchObject({
			OTEL_EXPORTER_OTLP_ENDPOINT: 'http://openobserve:5080/api/default',
			OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic abc',
			OTEL_SERVICE_NAME: 'backups',
		});
		expect(backups.env.OTEL_TRACES_SAMPLER_ARG).toBeUndefined();

		const noHeaders = input({
			telemetry: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' },
		});
		expect(noHeaders.env.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
		expect(noHeaders.env.OTEL_SERVICE_NAME).toBe('backups');
	});

	it('needs no key, and has no environment, in a stack that only builds', () => {
		const backups = input({ custom: {}, buildOnly: true });
		expect(backups.env).toEqual({});
		expect(backupsService(backups, false)).not.toHaveProperty('env_file');
	});

	it('names its image by what is in it: a new runner is a new image', () => {
		expect(input().image).toBe(input().image);
		expect(backupsDockerfile('postgres:18-alpine')).toContain(
			'CMD ["node", "/gkm/backup.mjs", "serve"]',
		);
		expect(runnerSource()).toContain('export {');
	});
});
