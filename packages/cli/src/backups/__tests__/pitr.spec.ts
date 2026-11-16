/**
 * Point-in-time recovery, as a deploy resolves it: `deploy.backups.<stage>.pitr`
 * read, the lifecycle rules it adds, and the stack it makes — a Postgres built
 * with WAL-G that archives its WAL, a backups service that takes base backups
 * from the data volume, read-only, and the grants that lets it.
 *
 * What WAL-G and Postgres do with it is the runner's suite and the e2e's.
 */

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
import { isStackKey } from '../../secrets/stackKeys';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import { WorkspaceConfigSchema } from '../../workspace/schema';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	backupExpiries,
	intoDatabase,
	pitrPrefix,
	stageBackups,
} from '../config';
import { intoDatabase as runnerIntoDatabase } from '../runner';
import {
	BackupIntervalInvalid,
	BackupRetentionInvalid,
	BackupsEntryInvalid,
	checkStageBackups,
} from '../schedule';
import {
	BACKUPS_SERVICE,
	backupsRoleStatements,
	newPitrKey,
	PITR_KEY,
	PitrKeyMissing,
	POSTGRES_SERVICE,
} from '../service';

const WITH_DATABASE = {
	Database: { kind: 'database' },
} as unknown as ConstructManifest;

function workspace(backups?: Record<string, unknown>): NormalizedWorkspace {
	return {
		name: 'shop',
		apps: {},
		deploy: { default: 'compose', ...(backups ? { backups } : {}) },
		stages: { local: 'dev', deployed: ['prod', 'staging'] },
		secrets: {},
	} as unknown as NormalizedWorkspace;
}

describe('deploy.backups.<stage>.pitr', () => {
	it('is off unless the entry names it', () => {
		const choice = stageBackups(workspace(), WITH_DATABASE, 'prod');
		if (choice.mode !== 'on') return expect.unreachable();
		expect(choice.backups.pitr).toBeUndefined();
	});

	it('takes true for a base backup a day, kept 14 days, its WAL a day longer', () => {
		const backups = checkStageBackups('prod', { pitr: true });
		if (!backups) return expect.unreachable();
		expect(backups.pitr).toMatchObject({
			keepDays: 14,
			base: { kind: 'every', seconds: 86_400, offset: 7_200 },
			walKeepDays: 15,
		});
		// The dumps keep their own schedule beside it.
		expect(backups.keepDays).toBe(30);
		expect(backups.schedule).toEqual({
			kind: 'every',
			seconds: 86_400,
			offset: 7_200,
		});
	});

	it('takes its own keep and base, the WAL kept a whole base interval longer', () => {
		const sixHourly = checkStageBackups('prod', {
			cron: '0 */6 * * *',
			pitr: { keep: '7d', base: '6h' },
		});
		if (!sixHourly) return expect.unreachable();
		expect(sixHourly.pitr).toMatchObject({
			keepDays: 7,
			base: { seconds: 6 * 3600 },
			walKeepDays: 8,
		});
		const weekly = checkStageBackups('prod', { pitr: { base: '7d' } });
		if (!weekly) return expect.unreachable();
		expect(weekly.pitr?.walKeepDays).toBe(14 + 7);
	});

	it.each([
		[{ pitr: false }, BackupsEntryInvalid],
		[{ pitr: 'yes' }, BackupsEntryInvalid],
		[{ pitr: { keep: '14d', every: '1d' } }, BackupsEntryInvalid],
		[{ pitr: { base: 6 } }, BackupsEntryInvalid],
		[{ pitr: { base: '30m' } }, BackupIntervalInvalid],
		[{ pitr: { keep: '2w' } }, BackupRetentionInvalid],
	])('refuses %j by name', (entry, error) => {
		expect(() => checkStageBackups('prod', entry)).toThrow(error);
	});

	it('names the key it refuses, so a bad pitr.base is not taken for every', () => {
		expect(() => checkStageBackups('prod', { pitr: { base: '30m' } })).toThrow(
			/deploy\.backups\.prod\.pitr\.base is '30m'/,
		);
		expect(() => checkStageBackups('prod', { pitr: { keep: '1y' } })).toThrow(
			/deploy\.backups\.prod\.pitr\.keep is '1y'/,
		);
	});

	it('is refused by the workspace schema with the same words', () => {
		const parsed = WorkspaceConfigSchema.safeParse({
			apps: {},
			deploy: { backups: { prod: { pitr: { base: '10m' } } } },
		});
		expect(parsed.success).toBe(false);
		expect(JSON.stringify(parsed.error?.issues)).toContain(
			'deploy.backups.prod.pitr.base',
		);
	});

	it('expires base backups after keep and WAL a base interval later, beside the runs', () => {
		expect(
			backupExpiries(
				workspace({ prod: { pitr: { keep: '7d', base: '12h' } } }),
				WITH_DATABASE,
			),
		).toEqual([
			{
				id: 'gkm-backups-prod',
				prefix: 'gkm/shop/prod/backups/2',
				days: 30,
				abortIncompleteDays: 1,
			},
			{
				id: 'gkm-backups-prod-pitr-base',
				prefix: 'gkm/shop/prod/backups/pitr/basebackups_005/',
				days: 7,
				abortIncompleteDays: 1,
			},
			{
				id: 'gkm-backups-prod-pitr-wal',
				prefix: 'gkm/shop/prod/backups/pitr/wal_005/',
				days: 8,
				abortIncompleteDays: 1,
			},
			{
				id: 'gkm-backups-staging',
				prefix: 'gkm/shop/staging/backups/2',
				days: 30,
				abortIncompleteDays: 1,
			},
		]);
	});

	it('is kept under the stage’s backups prefix, apart from the runs', () => {
		expect(pitrPrefix(workspace(), 'prod')).toBe('gkm/shop/prod/backups/pitr');
		// The runs' rule matches `2…`; the archive's folder never does.
		expect(pitrPrefix(workspace(), 'prod')).not.toMatch(/backups\/2/);
	});

	it('names a database copied --into the same way in the CLI and the runner', () => {
		expect(intoDatabase('drill', 'auth-database')).toBe('drill_auth_database');
		expect(runnerIntoDatabase('drill', 'auth-database')).toBe(
			intoDatabase('drill', 'auth-database'),
		);
	});

	it('keeps its key with the stack, out of every app', () => {
		expect(isStackKey(PITR_KEY)).toBe(true);
		expect(newPitrKey()).toMatch(/^[0-9a-f]{64}$/);
		expect(newPitrKey()).not.toBe(newPitrKey());
	});
});

const BACKUPS_URL =
	's3://AKIABACKUPS:s3cr3t%2Fkey@gkm-compose-app-000000000000?region=eu-west-1';
const KEY = 'ab'.repeat(32);

describe("a stage with point-in-time recovery's stack", () => {
	let dir: string;
	let ws: NormalizedWorkspace;
	let manifest: ConstructManifest;
	let background: Record<string, string[]>;

	beforeAll(async () => {
		dir = realpathSync(await createTempDir('gkm-backups-pitr-'));
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			target: 'compose',
			deployed: ['production', 'staging'],
			domains: {
				production: 'shop.example.com',
				staging: 'staging.example.com',
			},
			deployBackups: { production: { pitr: { keep: '7d', base: '6h' } } },
		});
		({ workspace: ws, manifest, background } = await loadComposeApp(dir));
	});

	afterAll(async () => {
		await cleanupDir(dir);
	});

	function secrets(custom: Record<string, string>): StageSecrets {
		return {
			...initStageSecrets('production'),
			seed: 'a-random-seed',
			custom: {
				AUTH_SECRET: 'the-signing-secret',
				REDIS_PASSWORD: 'the-redis-password',
				...custom,
			},
		};
	}

	function stack(
		stage = 'production',
		custom: Record<string, string> = { BACKUPS_URL, PITR_KEY: KEY },
		options: { buildOnly?: boolean } = {},
	): ComposeStack {
		return composeStack({
			workspace: ws,
			manifest,
			background,
			stage,
			identity: deployIdentity(ws, stage),
			images: { mode: 'pull', tag: 'v1' },
			secrets: secrets(custom),
			localCredentials: TEST_CREDENTIALS,
			...(options.buildOnly ? { buildOnly: true } : {}),
		});
	}

	it('builds its Postgres from its own image with WAL-G, archiving each minute', () => {
		const s = stack();
		const postgres = s.compose.services[POSTGRES_SERVICE];

		expect(postgres).toMatchObject({
			image: expect.stringMatching(
				/^compose-app-production-postgres:pg18-[0-9a-f]{12}$/,
			),
			build: { context: './postgres', dockerfile: 'Dockerfile' },
			pull_policy: 'build',
			command: [
				'postgres',
				'-c',
				'wal_level=replica',
				'-c',
				'archive_mode=on',
				'-c',
				'archive_command=wal-g wal-push %p',
				'-c',
				'archive_timeout=60',
			],
			env_file: [{ path: './postgres.env', format: 'raw' }],
			volumes: ['postgres-data:/var/lib/postgresql'],
		});
		// Still published on loopback only, with its own login and health check.
		expect(postgres?.ports).toEqual(['127.0.0.1::5432']);
		expect(postgres?.environment?.POSTGRES_USER).toBeDefined();
		expect(postgres?.healthcheck).toBeDefined();

		const dockerfile = s.backups?.pitr?.postgres.files.Dockerfile ?? '';
		expect(dockerfile).toContain('FROM golang:1-alpine AS wal-g');
		expect(dockerfile).toContain('--branch v3.0.9');
		expect(dockerfile).toContain('-tags libsodium');
		expect(dockerfile).toContain('FROM postgres:18-alpine');
		expect(dockerfile).toContain(
			'COPY --from=wal-g /wal-g /usr/local/bin/wal-g',
		);
	});

	it("hands WAL-G the stage's put-only key, the archive's prefix and the encryption key", () => {
		const { backups } = stack();
		const expected = {
			WALG_S3_PREFIX:
				's3://gkm-compose-app-000000000000/gkm/compose-app/production/backups/pitr',
			AWS_REGION: 'eu-west-1',
			AWS_ACCESS_KEY_ID: 'AKIABACKUPS',
			AWS_SECRET_ACCESS_KEY: 's3cr3t/key',
			WALG_LIBSODIUM_KEY: KEY,
			WALG_LIBSODIUM_KEY_TRANSFORM: 'hex',
		};
		expect(backups?.pitr?.postgres.env).toMatchObject(expected);
		expect(backups?.env).toMatchObject({
			...expected,
			PITR_BASE_SCHEDULE: JSON.stringify({
				kind: 'every',
				seconds: 6 * 3600,
				offset: 7_200,
			}),
			PITR_BASE_MAX_GAP_SECONDS: String(6 * 3600),
		});
	});

	it('mounts the data volume into the backups service read-only, and builds WAL-G into it', () => {
		const s = stack();
		expect(s.compose.services[BACKUPS_SERVICE]?.volumes).toEqual([
			'postgres-data:/var/lib/postgresql:ro',
		]);
		const dockerfile = s.backups?.files.Dockerfile ?? '';
		expect(dockerfile).toContain('FROM golang:1-alpine AS wal-g');
		expect(dockerfile).toContain(
			'COPY --from=wal-g /wal-g /usr/local/bin/wal-g',
		);
		expect(dockerfile).toContain('apk add --no-cache nodejs');
	});

	it('lets the backups role take a base backup and read the archiver, and write nothing', () => {
		const { backups } = stack();
		const sql = backupsRoleStatements(backups!).map((s) => s.create);
		expect(sql.slice(2)).toEqual([
			'GRANT pg_read_all_data TO "compose_app_backups"',
			'GRANT pg_monitor TO "compose_app_backups"',
			'GRANT EXECUTE ON FUNCTION pg_backup_start(text, boolean) TO "compose_app_backups"',
			'GRANT EXECUTE ON FUNCTION pg_backup_stop(boolean) TO "compose_app_backups"',
			'GRANT EXECUTE ON FUNCTION pg_switch_wal() TO "compose_app_backups"',
		]);
	});

	it('refuses to start without the encryption key the deploy writes, naming it', () => {
		expect(() => stack('production', { BACKUPS_URL })).toThrow(PitrKeyMissing);
	});

	it('leaves Postgres as it is where the stage has none, and in a stack that only builds', () => {
		const staging = stack('staging', { BACKUPS_URL });
		expect(staging.backups?.pitr).toBeUndefined();
		expect(staging.compose.services[POSTGRES_SERVICE]?.image).toBe(
			'postgres:18-alpine',
		);
		expect(staging.compose.services[POSTGRES_SERVICE]?.command).toBeUndefined();
		expect(staging.compose.services[BACKUPS_SERVICE]?.volumes).toBeUndefined();

		const built = stack('production', {}, { buildOnly: true });
		expect(built.compose.services[POSTGRES_SERVICE]?.image).toBe(
			'postgres:18-alpine',
		);
	});
});
