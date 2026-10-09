import { realpathSync } from 'node:fs';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { type ComposeStack, composeStack } from '../../compose/stack';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	BACKUPS_SERVICE,
	BackupsUrlMissing,
	backupsRoleStatements,
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
