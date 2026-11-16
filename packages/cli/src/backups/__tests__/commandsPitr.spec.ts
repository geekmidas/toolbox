/**
 * `backup:list`, `backup:now --base` and `backup:restore --to`, against the
 * AWS emulator the suite runs (floci) as S3 and the recording Docker the
 * compose suites use: the restore window read from the archive, what a
 * point-in-time restore refuses before anything changes, and what it asks
 * the stage's engine to run — in the order it asks.
 *
 * The recovery that really replays WAL is the runner's, under its own suite.
 */

import { realpathSync } from 'node:fs';
import {
	CreateBucketCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import * as s3Url from '@geekmidas/storage/s3-url';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	SERVER_IPV4,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { fakeDocker } from '../../compose/__tests__/__helpers__/fakeDocker';
import { loadWorkspaceConfig } from '../../config';
import { initStageSecrets } from '../../secrets/storage';
import { secretsStoreFor } from '../../secrets/store';
import {
	BackupRunNotChosen,
	backupListCommand,
	backupNowCommand,
	backupRestoreCommand,
	formatPitr,
	NoPitrBackups,
	PitrFlagsInvalid,
	PitrIntoInvalid,
	PitrNotOn,
	PitrRestoreFailed,
	type PitrRestoreOptions,
	PitrTargetInvalid,
	PitrTargetOutsideWindow,
	pitrWindow,
	RestoreNotConfirmed,
	restoreToTime,
} from '../commands';
import { PitrKeyMissing } from '../service';
import { removeBucket } from './__helpers__/bucket';

const REGION = 'eu-west-1';
const BUCKET = `gkm-pitr-${Date.now().toString(36)}`;
const ARCHIVE = 'gkm/shop/production/backups/pitr';
const EMPTY = 'gkm/shop/empty/backups/pitr';
const PROJECT = 'shop-production';
const KEY = 'cd'.repeat(32);

const s3 = new S3Client({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

async function put(Key: string) {
	await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: 'x' }));
}

const BASE_1 = 'base_000000010000000000000002';
const BASE_2 = 'base_000000010000000000000009';

beforeAll(async () => {
	await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
	// Two base backups, each its partitions and then its stop sentinel —
	// put last, as WAL-G does — and WAL after them.
	for (const base of [BASE_1, BASE_2]) {
		await put(
			`${ARCHIVE}/basebackups_005/${base}/tar_partitions/part_1.tar.lz4`,
		);
		await put(`${ARCHIVE}/basebackups_005/${base}/metadata.json`);
		await put(`${ARCHIVE}/basebackups_005/${base}_backup_stop_sentinel.json`);
	}
	await put(`${ARCHIVE}/wal_005/000000010000000000000009.lz4`);
	await put(`${ARCHIVE}/wal_005/00000001000000000000000A.lz4`);
	// Only partitions: a base backup that never finished.
	await put(`${EMPTY}/basebackups_005/${BASE_1}/tar_partitions/part_1.tar.lz4`);
	// S3 times an object to the second: a moment taken a second later is in
	// the window however the emulator rounds.
	await new Promise((r) => setTimeout(r, 1100));
});

afterAll(async () => {
	await removeBucket(s3, BUCKET);
});

describe('the restore window', () => {
	it('runs from when the oldest base backup finished to when the newest WAL was put', async () => {
		const window = await pitrWindow(s3, BUCKET, ARCHIVE);
		if (!window) return expect.unreachable();

		expect(window.bases.map((b) => b.name)).toEqual([BASE_1, BASE_2]);
		expect(window.earliest).toEqual(window.bases[0]!.finished);
		expect(window.latest!.getTime()).toBeGreaterThanOrEqual(
			window.bases[1]!.finished.getTime(),
		);
		expect(formatPitr(window)[0]).toMatch(
			/^restore window {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z → \d{4}-/,
		);
		// The newest base backup is listed first.
		expect(formatPitr(window)[1]).toContain(BASE_2);
	});

	it('is none until a base backup has finished', async () => {
		expect(await pitrWindow(s3, BUCKET, EMPTY)).toBeUndefined();
	});
});

describe('backup:restore --to', () => {
	const DATABASES = [
		{
			id: 'AuthDatabase',
			file: 'auth-database',
			name: 'auth_database_production',
		},
		{ id: 'Database', file: 'database', name: 'database_production' },
	];
	const running = [
		{ id: `${PROJECT}-postgres-1`, service: 'postgres' },
		{ id: `${PROJECT}-backups-1`, service: 'backups' },
		{ id: `${PROJECT}-api-1`, service: 'api' },
		{ id: `${PROJECT}-minio-1`, service: 'minio' },
	];
	let justNow: string;

	beforeEach(() => {
		justNow = new Date().toISOString();
	});

	const options = (
		docker: PitrRestoreOptions['docker'],
		parts: Partial<PitrRestoreOptions> = {},
	): PitrRestoreOptions => ({
		s3,
		archive: {
			bucket: BUCKET,
			region: REGION,
			endpoint: 'http://minio.internal:9000',
			prefix: ARCHIVE,
			key: KEY,
		},
		credentials: { accessKeyId: 'AKIACALLER', secretAccessKey: 'caller' },
		docker,
		project: PROJECT,
		engine: { host: 'ssh://deploy@203.0.113.10' },
		stage: 'production',
		superuser: { user: 'shop_admin', password: 'the-admin-password' },
		databases: DATABASES,
		to: justNow,
		keep: ['postgres', 'minio', 'caddy'],
		confirm: async () => true,
		log: () => {},
		...parts,
	});

	it('asks, takes a base backup, recovers beside the live cluster, then stops the stack, swaps and starts it, Postgres first', async () => {
		const { docker, calls } = fakeDocker({ running });
		const questions: string[] = [];
		const { target } = await restoreToTime(
			options(docker, {
				confirm: async (q) => {
					questions.push(q);
					return true;
				},
			}),
		);

		expect(target.toISOString()).toBe(justNow);
		expect(questions).toEqual([
			expect.stringContaining("Replace every database on 'production'"),
		]);
		expect(calls.map((c) => c.op)).toEqual([
			'container',
			'exec',
			'runOnce',
			'container',
			'stop',
			'runOnce',
			'start',
			'start',
			'exec',
		]);
		const [recover, swap] = calls
			.filter((c) => c.op === 'runOnce')
			.map(
				(c) =>
					c.args as {
						image: string;
						network: string;
						command: string[];
						env: Record<string, string>;
						volumes: string[];
					},
			);
		expect(recover).toMatchObject({
			image: `${PROJECT}-backups`,
			network: `${PROJECT}_default`,
			command: ['node', '/gkm/backup.mjs', 'recover'],
			volumes: [`${PROJECT}_postgres-data:/var/lib/postgresql`],
			env: {
				// The caller's credentials, the archive where the stack reaches it.
				AWS_ACCESS_KEY_ID: 'AKIACALLER',
				AWS_SECRET_ACCESS_KEY: 'caller',
				AWS_ENDPOINT: 'http://minio.internal:9000',
				WALG_S3_PREFIX: `s3://${BUCKET}/${ARCHIVE}`,
				WALG_LIBSODIUM_KEY: KEY,
				RECOVER_TARGET: justNow,
				RECOVER_SUPERUSER: 'shop_admin',
				PGHOST: 'postgres',
				PGPASSWORD: 'the-admin-password',
			},
		});
		expect(recover?.env.RECOVER_INTO).toBeUndefined();
		expect(swap?.command).toEqual(['node', '/gkm/backup.mjs', 'swap']);
		expect(swap?.volumes).toEqual(recover?.volumes);

		// A base backup before, and one of the new timeline after.
		const execs = calls.filter((c) => c.op === 'exec');
		expect(execs.map((c) => (c.args as { command: string[] }).command)).toEqual(
			[
				['node', '/gkm/backup.mjs', 'base'],
				['node', '/gkm/backup.mjs', 'base'],
			],
		);
		// Postgres stops with the apps and the backups container; the rest of
		// the infrastructure keeps running.
		expect(calls.find((c) => c.op === 'stop')?.args).toEqual([
			PROJECT,
			['minio', 'caddy'],
		]);
		expect(calls.filter((c) => c.op === 'start').map((c) => c.args)).toEqual([
			[`${PROJECT}-postgres-1`],
			[`${PROJECT}-backups-1`, `${PROJECT}-api-1`],
		]);
		expect(calls.every((c) => c.host === 'ssh://deploy@203.0.113.10')).toBe(
			true,
		);
	});

	it('with --into copies each database beside the live one, stopping nothing', async () => {
		const { docker, calls } = fakeDocker({ running });
		const { into } = await restoreToTime(options(docker, { into: 'drill' }));

		expect(into).toEqual(['drill_auth_database', 'drill_database']);
		expect(calls.map((c) => c.op)).toEqual(['container', 'exec', 'runOnce']);
		const run = calls.find((c) => c.op === 'runOnce')?.args as {
			env: Record<string, string>;
			volumes?: string[];
		};
		expect(run.env.RECOVER_INTO).toBe('drill');
		expect(run.volumes).toBeUndefined();
	});

	it.for([
		['a time still to come', { to: '2999-01-01T00:00:00Z' }, PitrTargetInvalid],
		['a time with no zone', { to: '2026-11-16 09:41' }, PitrTargetInvalid],
		['not a time', { to: 'yesterday' }, PitrTargetInvalid],
		[
			'a time before the window',
			{ to: '2001-01-01T00:00:00Z' },
			PitrTargetOutsideWindow,
		],
		['an --into that is no name', { into: 'Drill-1' }, PitrIntoInvalid],
		[
			'an archive with no base backup',
			{ archive: { bucket: BUCKET, prefix: EMPTY, key: KEY } },
			NoPitrBackups,
		],
		['a no', { confirm: async () => false }, RestoreNotConfirmed],
	] as const)('refuses %s, changing nothing', async ([, parts, error]) => {
		const { docker, calls } = fakeDocker({ running });
		await expect(
			restoreToTime(options(docker, parts as Partial<PitrRestoreOptions>)),
		).rejects.toBeInstanceOf(error);
		expect(calls.filter((c) => c.op !== 'container')).toEqual([]);
	});

	it('changes nothing live when the recovery fails', async () => {
		const { docker, calls } = fakeDocker({ running, runOnce: () => 1 });
		await expect(restoreToTime(options(docker))).rejects.toBeInstanceOf(
			PitrRestoreFailed,
		);
		expect(calls.map((c) => c.op)).toEqual(['container', 'exec', 'runOnce']);
	});

	it('starts the stack again on the live cluster when the swap fails', async () => {
		const { docker, calls } = fakeDocker({
			running,
			runOnce: (run) => (run.command.at(-1) === 'swap' ? 1 : 0),
		});
		await expect(restoreToTime(options(docker))).rejects.toBeInstanceOf(
			PitrRestoreFailed,
		);
		expect(calls.filter((c) => c.op === 'start').map((c) => c.args)).toEqual([
			[`${PROJECT}-postgres-1`],
			[`${PROJECT}-backups-1`, `${PROJECT}-api-1`],
		]);
		// No base backup of a timeline that never went live.
		expect(calls.filter((c) => c.op === 'exec')).toHaveLength(1);
	});
});

describe('the commands, on a workspace with point-in-time recovery', () => {
	let dir: string;
	const lines: string[] = [];
	const url = s3Url.build({
		bucket: BUCKET,
		region: REGION,
		accessKeyId: 'AKIAPUTONLY',
		secretAccessKey: 'put-only',
	});

	async function secrets(stage: string, custom: Record<string, string>) {
		const { workspace } = await loadWorkspaceConfig(dir);
		const store = await secretsStoreFor(workspace, stage);
		await store.write(stage, {
			...initStageSecrets(stage),
			seed: 'a-seed',
			custom,
		});
	}

	beforeAll(async () => {
		vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
		vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
		vi.stubEnv('AWS_REGION', REGION);
		vi.stubEnv('AWS_PROFILE', undefined);
		dir = realpathSync(await createTempDir('gkm-backups-pitr-commands-'));
		writeComposeApp(dir, {
			name: 'shop',
			target: 'compose',
			deployed: ['production', 'staging', 'qa'],
			domains: {
				production: 'shop.example.com',
				staging: 'staging.shop.example.com',
				qa: 'qa.shop.example.com',
			},
			deployBackups: { production: { pitr: true }, qa: { pitr: true } },
		});
		const server = { GKM_SERVER_IPV4: SERVER_IPV4 };
		await secrets('production', { BACKUPS_URL: url, PITR_KEY: KEY, ...server });
		await secrets('staging', { BACKUPS_URL: url, ...server });
		await secrets('qa', { BACKUPS_URL: url, ...server });
	}, 120_000);

	beforeEach(() => {
		lines.length = 0;
		vi.spyOn(console, 'log').mockImplementation((line) => {
			lines.push(String(line));
		});
	});

	afterAll(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await cleanupDir(dir);
	});

	it('backup:list shows the restore window beside the runs', async () => {
		const listing = await backupListCommand({ stage: 'production', cwd: dir });
		if (!listing.pitr) return expect.unreachable();
		expect(listing.pitr.bases.map((b) => b.name)).toEqual([BASE_1, BASE_2]);
		expect(lines).toEqual([
			"No backups of 'production' yet.",
			'\n⏱️  Point-in-time — gkm backup:restore --stage production --to <time>\n',
			...formatPitr(listing.pitr),
		]);

		lines.length = 0;
		await backupListCommand({ stage: 'staging', cwd: dir });
		expect(lines.join('\n')).not.toContain('Point-in-time');
	});

	it('backup:now --base takes a base backup on the stage server', async () => {
		const { docker, calls } = fakeDocker();
		await backupNowCommand(
			{ stage: 'production', cwd: dir, base: true },
			docker,
		);
		expect(calls).toEqual([
			expect.objectContaining({
				op: 'exec',
				host: `ssh://deploy@${SERVER_IPV4}`,
				args: expect.objectContaining({
					project: 'shop-production',
					command: ['node', '/gkm/backup.mjs', 'base'],
				}),
			}),
		]);
		await expect(
			backupNowCommand({ stage: 'staging', cwd: dir, base: true }, docker),
		).rejects.toBeInstanceOf(PitrNotOn);
	});

	it('backup:restore --to --yes recovers with the caller’s credentials and the stage’s key, asking nothing', async () => {
		const { docker, calls } = fakeDocker();
		await backupRestoreCommand(
			{
				stage: 'production',
				cwd: dir,
				to: new Date().toISOString(),
				into: 'drill',
				yes: true,
			},
			docker,
		);
		const run = calls.find((c) => c.op === 'runOnce')?.args as {
			env: Record<string, string>;
		};
		expect(run.env).toMatchObject({
			AWS_ACCESS_KEY_ID: 'test',
			AWS_SECRET_ACCESS_KEY: 'test',
			AWS_REGION: REGION,
			WALG_S3_PREFIX: `s3://${BUCKET}/${ARCHIVE}`,
			WALG_LIBSODIUM_KEY: KEY,
			PGUSER: 'shop_admin',
			RECOVER_INTO: 'drill',
		});
		expect(lines.at(-1)).toMatch(
			/^✅ Restored 'production' as it was at .* into drill_database\.$/,
		);
	});

	it.for([
		[
			'--to on a stage without it',
			{ stage: 'staging', to: '2026-11-01T00:00:00Z' },
			PitrNotOn,
		],
		[
			'--to with --database',
			{ stage: 'production', to: '2026-11-01T00:00:00Z', database: 'database' },
			PitrFlagsInvalid,
		],
		[
			'--into without --to',
			{ stage: 'production', latest: true, into: 'drill' },
			PitrFlagsInvalid,
		],
		[
			'--to beside --at',
			{
				stage: 'production',
				to: '2026-11-01T00:00:00Z',
				at: '2026-11-01T00:00:00Z',
			},
			BackupRunNotChosen,
		],
		[
			'--to with no key to decrypt with',
			{ stage: 'qa', to: '2026-11-01T00:00:00Z' },
			PitrKeyMissing,
		],
	] as const)('refuses %s', async ([, flags, error]) => {
		const { docker, calls } = fakeDocker();
		await expect(
			backupRestoreCommand({ cwd: dir, yes: true, ...flags }, docker),
		).rejects.toBeInstanceOf(error);
		expect(calls).toEqual([]);
	});
});
