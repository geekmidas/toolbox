/**
 * `backup:list`, `backup:now` and `backup:restore`, against the AWS emulator
 * the suite runs (floci) as S3 and the recording Docker the compose suites
 * use: which run a restore picks, what it refuses before anything changes,
 * and what it asks the stage's engine to run — in the order it asks.
 *
 * The restore that really replays a dump into Postgres is the e2e suite's.
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
import {
	type ComposeDocker,
	ContainersNotStarted,
	ContainersNotStopped,
} from '../../compose/docker';
import { loadWorkspaceConfig } from '../../config';
import { initStageSecrets } from '../../secrets/storage';
import { secretsStoreFor } from '../../secrets/store';
import {
	AppsNotRestarted,
	BackupDatabaseMissing,
	BackupDatabaseUnknown,
	type BackupRun,
	BackupRunFailed,
	BackupRunNotChosen,
	BackupRunNotFound,
	BackupsContainerNotRunning,
	BackupsNotOn,
	BackupsNotProvisioned,
	backupListCommand,
	backupNow,
	backupNowCommand,
	backupRestoreCommand,
	chooseRun,
	formatImports,
	formatRuns,
	formatSize,
	ImportNeedsDatabase,
	ImportNotFound,
	ImportPathInvalid,
	importKey,
	listBackups,
	listImports,
	NoBackups,
	RestoreFailed,
	RestoreNotConfirmed,
	restoreBackup,
} from '../commands';
import { removeBucket } from './__helpers__/bucket';

const REGION = 'eu-west-1';
const BUCKET = `gkm-commands-${Date.now().toString(36)}`;
const PREFIX = 'gkm/shop/production/backups';
const PROJECT = 'shop-production';

const s3 = new S3Client({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

const DATABASES = [
	{
		id: 'AuthDatabase',
		file: 'auth-database',
		name: 'auth_database_production',
	},
	{ id: 'Database', file: 'database', name: 'database_production' },
];
const SUPERUSER = { user: 'shop_admin', password: 'the-admin-password' };

async function put(Key: string, Body: string) {
	await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body }));
}

beforeAll(async () => {
	await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
	await put(
		`${PREFIX}/2026-10-08/02-00-00Z/auth-database.sql.gz`,
		'a'.repeat(10),
	);
	await put(`${PREFIX}/2026-10-08/02-00-00Z/database.sql.gz`, 'd'.repeat(2048));
	await put(
		`${PREFIX}/2026-10-09/02-00-00Z/database.sql.gz`,
		'd'.repeat(3 * 1024 * 1024),
	);
	await put(
		`${PREFIX}/2026-10-09/02-00-00Z/auth-database.sql.gz`,
		'a'.repeat(20),
	);
	// One that lost a database, and keys that are no run's.
	await put(`${PREFIX}/2026-10-09/14-30-00Z/database.sql.gz`, 'd');
	await put(`${PREFIX}/.gkm-verify`, 'marker');
	// Imports, one shaped like a run and newer than any: never a run.
	await put(`${PREFIX}/imports/app.sql.gz`, 'i'.repeat(30));
	await put(
		`${PREFIX}/imports/2026-12-01/02-00-00Z/database.sql.gz`,
		'i'.repeat(5),
	);
	await put(`${PREFIX}/2026-10-09/notes.txt`, 'x');
});

afterAll(async () => {
	await removeBucket(s3, BUCKET);
});

describe('backup:list', () => {
	it("lists each run newest first, with each database's size, and nothing that is no run's", async () => {
		const runs = await listBackups(s3, BUCKET, PREFIX);

		expect(runs.map((r) => r.folder)).toEqual([
			'2026-10-09/14-30-00Z',
			'2026-10-09/02-00-00Z',
			'2026-10-08/02-00-00Z',
		]);
		expect(runs[1]).toEqual({
			folder: '2026-10-09/02-00-00Z',
			at: new Date('2026-10-09T02:00:00Z'),
			files: [
				{ database: 'auth-database', size: 20 },
				{ database: 'database', size: 3 * 1024 * 1024 },
			],
		});
		expect(formatRuns(runs)).toEqual([
			'2026-10-09 14:30:00Z  2026-10-09/14-30-00Z  database (1 B)',
			'2026-10-09 02:00:00Z  2026-10-09/02-00-00Z  auth-database (20 B), database (3.0 MB)',
			'2026-10-08 02:00:00Z  2026-10-08/02-00-00Z  auth-database (10 B), database (2.0 KB)',
		]);
	});

	it('is empty for a stage with none', async () => {
		expect(await listBackups(s3, BUCKET, 'gkm/shop/qa/backups')).toEqual([]);
	});

	it('lists the imports apart from the runs, by the name --from takes', async () => {
		const imports = await listImports(s3, BUCKET, PREFIX);
		expect(imports.map(({ file, size }) => ({ file, size }))).toEqual([
			{ file: 'imports/2026-12-01/02-00-00Z/database.sql.gz', size: 5 },
			{ file: 'imports/app.sql.gz', size: 30 },
		]);
		expect(imports[0]!.modified).toBeInstanceOf(Date);
		expect(
			formatImports([
				{
					file: 'imports/app.sql.gz',
					size: 1536,
					modified: new Date('2026-11-01T10:00:00.500Z'),
				},
				{ file: 'imports/b.sql.gz', size: 3 },
			]),
		).toEqual([
			'imports/app.sql.gz  1.5 KB  uploaded 2026-11-01 10:00:00Z',
			'imports/b.sql.gz  3 B',
		]);
		expect(await listImports(s3, BUCKET, 'gkm/shop/qa/backups')).toEqual([]);
	});

	it('says a size the way a person reads it', () => {
		expect(formatSize(0)).toBe('0 B');
		expect(formatSize(1023)).toBe('1023 B');
		expect(formatSize(1536)).toBe('1.5 KB');
		expect(formatSize(20 * 1024 * 1024)).toBe('20 MB');
		expect(formatSize(5 * 1024 ** 4)).toBe('5.0 TB');
		expect(formatSize(3 * 1024 ** 5)).toBe('3072 TB');
	});
});

describe('which run a restore takes', () => {
	let runs: BackupRun[];
	beforeAll(async () => {
		runs = await listBackups(s3, BUCKET, PREFIX);
	});

	it('is the newest with --latest — never an import, however it is named', () => {
		expect(chooseRun(runs, { latest: true }).folder).toBe(
			'2026-10-09/14-30-00Z',
		);
	});

	it('is the folder --at names', () => {
		expect(chooseRun(runs, { at: '/2026-10-08/02-00-00Z/' }).folder).toBe(
			'2026-10-08/02-00-00Z',
		);
	});

	it('is the newest at or before a time --at gives', () => {
		expect(chooseRun(runs, { at: '2026-10-09T12:00:00Z' }).folder).toBe(
			'2026-10-09/02-00-00Z',
		);
		expect(chooseRun(runs, { at: '2026-10-09T02:00:00Z' }).folder).toBe(
			'2026-10-09/02-00-00Z',
		);
	});

	it('is none, by name, before the first run or for what is not a time', () => {
		expect(() => chooseRun(runs, { at: '2026-01-01T00:00:00Z' })).toThrow(
			BackupRunNotFound,
		);
		expect(() => chooseRun(runs, { at: 'yesterday-ish' })).toThrow(
			/No backup at or before 'yesterday-ish'/,
		);
	});
});

describe('backup:now', () => {
	it("runs the runner in the stack's backups container, on the stage's engine", async () => {
		const { docker, calls } = fakeDocker({
			exec: () => ({ code: 0, stdout: '{"ok":true}\n', stderr: '' }),
		});
		const lines: string[] = [];
		await backupNow({
			docker,
			project: PROJECT,
			engine: { host: 'ssh://deploy@203.0.113.10' },
			log: (line) => lines.push(line),
		});
		expect(calls).toEqual([
			{
				op: 'exec',
				args: {
					project: PROJECT,
					service: 'backups',
					command: ['node', '/gkm/backup.mjs', 'run'],
					input: undefined,
				},
				host: 'ssh://deploy@203.0.113.10',
			},
		]);
		expect(lines).toEqual(['{"ok":true}']);
	});

	it('says the container is not running, or that the run failed', async () => {
		await expect(
			backupNow({
				docker: fakeDocker({
					exec: () => ({ code: null, stdout: '', stderr: 'not running' }),
				}).docker,
				project: PROJECT,
			}),
		).rejects.toBeInstanceOf(BackupsContainerNotRunning);
		await expect(
			backupNow({
				docker: fakeDocker({
					exec: () => ({ code: 1, stdout: '', stderr: '{"ok":false}' }),
				}).docker,
				project: PROJECT,
			}),
		).rejects.toMatchObject({ name: 'BackupRunFailed', code: 1 });
	});
});

describe('backup:restore', () => {
	const restore = (
		options: Partial<Parameters<typeof restoreBackup>[0]> & {
			docker: ComposeDocker;
		},
	) =>
		restoreBackup({
			s3,
			bucket: BUCKET,
			prefix: PREFIX,
			project: PROJECT,
			engine: { host: 'ssh://deploy@203.0.113.10' },
			stage: 'production',
			superuser: SUPERUSER,
			databases: DATABASES,
			confirm: async () => true,
			log: () => {},
			...options,
		});

	it('asks, backs up, then recreates each database from its file in a one-off container on the stack network', async () => {
		const { docker, calls } = fakeDocker();
		const asked: string[] = [];
		const restored: { env: unknown; body: string }[] = [];
		const runOnce = docker.runOnce.bind(docker);
		docker.runOnce = async (engine, run) => {
			let body = '';
			for await (const chunk of run.stdin as AsyncIterable<Buffer>) {
				body += chunk.toString();
			}
			restored.push({ env: run.env, body });
			return runOnce(engine, { ...run, stdin: undefined });
		};

		const result = await restore({
			docker,
			at: '2026-10-08/02-00-00Z',
			confirm: async (question) => {
				asked.push(question);
				return true;
			},
		});

		expect(result.run?.folder).toBe('2026-10-08/02-00-00Z');
		expect(result.restored).toEqual(['auth-database', 'database']);
		expect(asked).toEqual([
			"Replace auth_database_production, database_production on 'production' with the backup 2026-10-08/02-00-00Z? Everything written since is lost (a backup is taken first).",
		]);
		expect(calls.map((c) => c.op)).toEqual([
			'container',
			'exec',
			'runOnce',
			'runOnce',
		]);
		expect(calls.every((c) => c.host === 'ssh://deploy@203.0.113.10')).toBe(
			true,
		);
		const run = calls[2]!.args as {
			image: string;
			network: string;
			command: string[];
		};
		expect(run.image).toBe(`${PROJECT}-backups`);
		expect(run.network).toBe(`${PROJECT}_default`);
		expect(run.command.slice(0, 2)).toEqual(['sh', '-c']);
		expect(run.command[2]).toContain('ALLOW_CONNECTIONS');
		expect(run.command[2]).toContain('gunzip | psql');
		expect(restored).toEqual([
			{
				env: {
					PGHOST: 'postgres',
					PGPORT: '5432',
					PGUSER: 'shop_admin',
					PGPASSWORD: 'the-admin-password',
					PGDATABASE: 'postgres',
					RESTORE_DATABASE: 'auth_database_production',
				},
				body: 'a'.repeat(10),
			},
			{
				env: expect.objectContaining({
					RESTORE_DATABASE: 'database_production',
				}),
				body: 'd'.repeat(2048),
			},
		]);
	});

	it('restores one database with --database', async () => {
		const { docker, calls } = fakeDocker();
		const result = await restore({
			docker,
			latest: true,
			database: 'database',
		});
		expect(result).toMatchObject({
			run: { folder: '2026-10-09/14-30-00Z' },
			restored: ['database'],
		});
		expect(calls.filter((c) => c.op === 'runOnce')).toHaveLength(1);
	});

	it('changes nothing when the answer is no', async () => {
		const { docker, calls } = fakeDocker();
		await expect(
			restore({
				docker,
				at: '2026-10-08/02-00-00Z',
				confirm: async () => false,
			}),
		).rejects.toBeInstanceOf(RestoreNotConfirmed);
		expect(calls.map((c) => c.op)).toEqual(['container']);
	});

	it('refuses a run that lacks a database, before asking anything', async () => {
		const { docker, calls } = fakeDocker();
		const error = await restore({ docker, latest: true }).catch((e) => e);
		expect(error).toBeInstanceOf(BackupDatabaseMissing);
		expect(error).toMatchObject({
			folder: '2026-10-09/14-30-00Z',
			database: 'auth-database',
			has: ['database'],
		});
		expect(calls).toEqual([]);
	});

	it('refuses a database the stack does not run, and a choice of neither or both runs', async () => {
		const { docker } = fakeDocker();
		await expect(
			restore({ docker, latest: true, database: 'analytics' }),
		).rejects.toBeInstanceOf(BackupDatabaseUnknown);
		await expect(restore({ docker })).rejects.toBeInstanceOf(
			BackupRunNotChosen,
		);
		await expect(
			restore({ docker, latest: true, at: '2026-10-08/02-00-00Z' }),
		).rejects.toBeInstanceOf(BackupRunNotChosen);
	});

	it('says there is nothing to restore on a stage with no backups', async () => {
		const { docker } = fakeDocker();
		await expect(
			restore({ docker, latest: true, prefix: 'gkm/shop/qa/backups' }),
		).rejects.toBeInstanceOf(NoBackups);
	});

	it('stops when the container is gone, the backup first fails, or psql does', async () => {
		const gone = fakeDocker().docker;
		gone.container = async () => undefined;
		await expect(
			restore({ docker: gone, at: '2026-10-08/02-00-00Z' }),
		).rejects.toBeInstanceOf(BackupsContainerNotRunning);

		const failing = fakeDocker({
			exec: () => ({ code: 1, stdout: '', stderr: '' }),
		});
		await expect(
			restore({ docker: failing.docker, at: '2026-10-08/02-00-00Z' }),
		).rejects.toBeInstanceOf(BackupRunFailed);
		expect(failing.calls.some((c) => c.op === 'runOnce')).toBe(false);

		const psql = fakeDocker().docker;
		psql.runOnce = async () => 3;
		await expect(
			restore({ docker: psql, at: '2026-10-08/02-00-00Z' }),
		).rejects.toMatchObject({
			name: 'RestoreFailed',
			database: 'auth_database_production',
			code: 3,
		});
		expect(RestoreFailed).toBeDefined();
	});
});

describe('backup:restore --from', () => {
	const RUNNING = [
		{ id: 'c-postgres', service: 'postgres' },
		{ id: 'c-backups', service: 'backups' },
		{ id: 'c-redis', service: 'redis' },
		{ id: 'c-caddy', service: 'caddy' },
		{ id: 'c-api', service: 'api' },
		{ id: 'c-api-2', service: 'api-2' },
		{ id: 'c-jobs', service: 'jobs' },
	];
	const restore = (
		options: Partial<Parameters<typeof restoreBackup>[0]> & {
			docker: ComposeDocker;
		},
	) =>
		restoreBackup({
			s3,
			bucket: BUCKET,
			prefix: PREFIX,
			project: PROJECT,
			engine: { host: 'ssh://deploy@203.0.113.10' },
			stage: 'production',
			superuser: SUPERUSER,
			databases: DATABASES,
			from: 'imports/app.sql.gz',
			database: 'database',
			keep: ['postgres', 'redis', 'caddy'],
			confirm: async () => true,
			log: () => {},
			...options,
		});

	it('asks, backs up, stops the apps, loads the file inside the database in one transaction, then starts them', async () => {
		const { docker, calls } = fakeDocker({ running: RUNNING });
		const asked: string[] = [];
		let body = '';
		const runOnce = docker.runOnce.bind(docker);
		docker.runOnce = async (engine, run) => {
			for await (const chunk of run.stdin as AsyncIterable<Buffer>) {
				body += chunk.toString();
			}
			return runOnce(engine, { ...run, stdin: undefined });
		};

		const result = await restore({
			docker,
			confirm: async (question) => {
				asked.push(question);
				return true;
			},
		});

		expect(result).toEqual({
			from: 'imports/app.sql.gz',
			restored: ['database'],
		});
		expect(asked).toEqual([
			"Load imports/app.sql.gz into database_production on 'production'? Its apps are stopped while it loads, and what the file replaces is lost (a backup is taken first).",
		]);
		expect(calls.map((c) => c.op)).toEqual([
			'container',
			'exec',
			'stop',
			'runOnce',
			'start',
		]);
		expect(calls.every((c) => c.host === 'ssh://deploy@203.0.113.10')).toBe(
			true,
		);
		// Postgres and the backups container always stay; so does what the
		// stack names as its infrastructure.
		expect(calls[2]!.args).toEqual([
			PROJECT,
			['postgres', 'backups', 'postgres', 'redis', 'caddy'],
		]);
		expect(calls[4]!.args).toEqual(['c-api', 'c-api-2', 'c-jobs']);

		const run = calls[3]!.args as {
			network: string;
			command: string[];
			env: Record<string, string>;
		};
		expect(run.network).toBe(`${PROJECT}_default`);
		const script = run.command[2]!;
		expect(script).not.toContain('ALLOW_CONNECTIONS');
		expect(script).toContain('pg_terminate_backend');
		expect(script).toContain(
			'gunzip | psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$RESTORE_DATABASE" -f -',
		);
		expect(run.env).toMatchObject({
			PGUSER: 'shop_admin',
			RESTORE_DATABASE: 'database_production',
		});
		expect(body).toBe('i'.repeat(30));
	});

	it('starts the apps again when the file fails, and says the load failed', async () => {
		const { docker, calls } = fakeDocker({ running: RUNNING });
		docker.runOnce = async () => 3;
		await expect(restore({ docker })).rejects.toMatchObject({
			name: 'RestoreFailed',
			database: 'database_production',
			code: 3,
		});
		expect(calls.map((c) => c.op)).toEqual([
			'container',
			'exec',
			'stop',
			'start',
		]);
		expect(calls.at(-1)!.args).toEqual(['c-api', 'c-api-2', 'c-jobs']);
	});

	it('starts the apps again when the load cannot even start', async () => {
		const { docker, calls } = fakeDocker({ running: RUNNING });
		docker.runOnce = async () => {
			throw new Error('docker is gone');
		};
		await expect(restore({ docker })).rejects.toThrow('docker is gone');
		expect(calls.map((c) => c.op).slice(-2)).toEqual(['stop', 'start']);
	});

	it('says so, naming what to start, when the apps do not start again', async () => {
		const { docker } = fakeDocker({ running: RUNNING });
		docker.start = async (_engine, ids) => {
			throw new ContainersNotStarted(ids, 'no such container');
		};
		const error = await restore({ docker }).catch((e) => e);
		expect(error).toBeInstanceOf(AppsNotRestarted);
		expect(error).toMatchObject({
			loaded: true,
			ids: ['c-api', 'c-api-2', 'c-jobs'],
			output: 'no such container',
		});
		expect(error.message).toContain('docker start c-api c-api-2 c-jobs');
	});

	it('starts what did stop when stopping the apps fails, and loads nothing', async () => {
		const { docker, calls } = fakeDocker({ running: RUNNING });
		docker.stop = async (_engine, project) => {
			throw new ContainersNotStopped(project, ['c-api', 'c-jobs'], 'timeout');
		};
		await expect(restore({ docker })).rejects.toBeInstanceOf(
			ContainersNotStopped,
		);
		expect(calls.map((c) => c.op)).toEqual(['container', 'exec', 'start']);
		expect(calls.at(-1)!.args).toEqual(['c-api', 'c-jobs']);
	});

	it('refuses, before anything changes, a path outside imports/, no database, an unknown one, or a missing file', async () => {
		const { docker, calls } = fakeDocker({ running: RUNNING });
		for (const from of [
			'../production/backups/imports/app.sql.gz',
			'imports/../2026-10-08/02-00-00Z/database.sql.gz',
			'/gkm/shop/production/backups/imports/app.sql.gz',
			's3://elsewhere/imports/app.sql.gz',
			'https://example.com/app.sql.gz',
			'2026-10-08/02-00-00Z/database.sql.gz',
			'imports//app.sql.gz',
			'imports/./app.sql.gz',
			'imports\\app.sql.gz',
			'imports/app.sql',
			'imports',
		]) {
			await expect(restore({ docker, from }), from).rejects.toBeInstanceOf(
				ImportPathInvalid,
			);
		}
		await expect(
			restore({ docker, database: undefined }),
		).rejects.toMatchObject({
			name: 'ImportNeedsDatabase',
			known: ['auth-database', 'database'],
		});
		await expect(
			restore({ docker, database: 'analytics' }),
		).rejects.toBeInstanceOf(BackupDatabaseUnknown);
		await expect(
			restore({ docker, from: 'imports/nope.sql.gz' }),
		).rejects.toBeInstanceOf(ImportNotFound);
		expect(calls).toEqual([]);
		expect(ImportNeedsDatabase).toBeDefined();
	});

	it('is one source: never with --at or --latest', async () => {
		const { docker } = fakeDocker();
		await expect(restore({ docker, latest: true })).rejects.toBeInstanceOf(
			BackupRunNotChosen,
		);
		await expect(
			restore({ docker, at: '2026-10-08/02-00-00Z' }),
		).rejects.toBeInstanceOf(BackupRunNotChosen);
	});

	it('keys a file under the prefix it names', () => {
		expect(importKey(PREFIX, 'imports/app.sql.gz')).toBe(
			`${PREFIX}/imports/app.sql.gz`,
		);
		expect(importKey(PREFIX, 'imports/2026/rds.sql.gz')).toBe(
			`${PREFIX}/imports/2026/rds.sql.gz`,
		);
	});
});

describe('the commands, on a workspace', () => {
	let dir: string;
	const lines: string[] = [];

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
		dir = realpathSync(await createTempDir('gkm-backups-commands-'));
		writeComposeApp(dir, {
			name: 'shop',
			target: 'compose',
			deployed: ['production', 'staging', 'qa', 'demo'],
			domains: {
				production: 'shop.example.com',
				staging: 'staging.shop.example.com',
				qa: 'qa.shop.example.com',
				demo: 'demo.shop.example.com',
			},
			deployBackups: { staging: false },
		});
		await secrets('production', {
			BACKUPS_URL: s3Url.build({
				bucket: BUCKET,
				region: REGION,
				accessKeyId: 'AKIAPUTONLY',
				secretAccessKey: 'put-only',
			}),
			GKM_SERVER_IPV4: SERVER_IPV4,
		});
		await secrets('qa', { GKM_SERVER_IPV4: SERVER_IPV4 });
		await secrets('demo', {
			BACKUPS_URL: s3Url.build({ bucket: BUCKET, region: REGION }),
			GKM_SERVER_IPV4: SERVER_IPV4,
		});
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

	it("backup:list reads the stage's bucket with the caller's own credentials, imports apart", async () => {
		const { runs, imports } = await backupListCommand({
			stage: 'production',
			cwd: dir,
		});
		expect(runs.map((r) => r.folder)).toEqual([
			'2026-10-09/14-30-00Z',
			'2026-10-09/02-00-00Z',
			'2026-10-08/02-00-00Z',
		]);
		expect(imports.map((i) => i.file)).toEqual([
			'imports/2026-12-01/02-00-00Z/database.sql.gz',
			'imports/app.sql.gz',
		]);
		expect(lines).toEqual([
			`💾 s3://${BUCKET}/${PREFIX}/ — newest first\n`,
			...formatRuns(runs),
			'\n📥 Imports — gkm backup:restore --stage production --from <file> --database <name>\n',
			...formatImports(imports),
		]);

		lines.length = 0;
		await backupListCommand({ stage: 'production', cwd: dir, json: true });
		const json = JSON.parse(lines[0]!);
		expect(json.runs).toHaveLength(3);
		expect(json.imports).toHaveLength(2);
	});

	it('backup:now runs on the stage server, over SSH', async () => {
		const { docker, calls } = fakeDocker();
		await backupNowCommand({ stage: 'production', cwd: dir }, docker);
		expect(calls).toEqual([
			expect.objectContaining({
				op: 'exec',
				host: `ssh://deploy@${SERVER_IPV4}`,
				args: expect.objectContaining({ project: 'shop-production' }),
			}),
		]);
	});

	it('backup:restore --yes restores as the superuser the stage seed derives, asking nothing', async () => {
		const { docker, calls } = fakeDocker();
		await backupRestoreCommand(
			{ stage: 'production', cwd: dir, at: '2026-10-09T03:00:00Z', yes: true },
			docker,
		);
		// The stack's one database; its auth tenant is a schema inside it.
		const runs = calls.filter((c) => c.op === 'runOnce');
		expect(runs).toHaveLength(1);
		const env = (runs[0]!.args as { env: Record<string, string> }).env;
		expect(env.PGUSER).toBe('shop_admin');
		expect(env.PGPASSWORD).toMatch(/^[\w-]{32}$/);
		expect(lines.at(-1)).toBe(
			"✅ Restored database on 'production' from 2026-10-09/02-00-00Z.",
		);
		await expect(
			backupRestoreCommand({ stage: 'production', cwd: dir }, docker),
		).rejects.toBeInstanceOf(BackupRunNotChosen);
	});

	it('names a stage that takes no backups, or has never been deployed with them', async () => {
		await expect(
			backupListCommand({ stage: 'staging', cwd: dir }),
		).rejects.toMatchObject({
			name: 'BackupsNotOn',
			message: "'staging' takes no backups: deploy.backups.staging is false.",
		});
		await expect(
			backupListCommand({ stage: 'development', cwd: dir }),
		).rejects.toThrow(BackupsNotOn);
		await expect(
			backupListCommand({ stage: 'qa', cwd: dir }),
		).rejects.toBeInstanceOf(BackupsNotProvisioned);
		await expect(
			backupRestoreCommand(
				{ stage: 'qa', cwd: dir, latest: true, yes: true },
				fakeDocker().docker,
			),
		).rejects.toBeInstanceOf(BackupsNotProvisioned);
	});

	it('backup:list says a stage has none yet', async () => {
		expect(await backupListCommand({ stage: 'demo', cwd: dir })).toEqual({
			runs: [],
			imports: [],
		});
		expect(lines).toEqual(["No backups of 'demo' yet."]);
	});

	it('backup:restore --from loads an import with the stack infrastructure kept running', async () => {
		const { docker, calls } = fakeDocker();
		await backupRestoreCommand(
			{
				stage: 'production',
				cwd: dir,
				from: 'imports/app.sql.gz',
				database: 'database',
				yes: true,
			},
			docker,
		);
		const stop = calls.find((c) => c.op === 'stop')!;
		const [project, keep] = stop.args as [string, string[]];
		expect(project).toBe('shop-production');
		expect(keep).toEqual(
			expect.arrayContaining(['postgres', 'backups', 'caddy']),
		);
		expect(keep).not.toContain('api');
		expect(calls.map((c) => c.op)).toEqual([
			'container',
			'exec',
			'stop',
			'runOnce',
			'start',
		]);
		expect(lines.at(-1)).toBe(
			"✅ Restored database on 'production' from imports/app.sql.gz.",
		);
	});

	it('backup:restore --from refuses a path that escapes, or no --database, before reading anything', async () => {
		const { docker, calls } = fakeDocker();
		await expect(
			backupRestoreCommand(
				{
					stage: 'production',
					cwd: dir,
					from: '../staging/backups/imports/app.sql.gz',
					database: 'database',
					yes: true,
				},
				docker,
			),
		).rejects.toBeInstanceOf(ImportPathInvalid);
		await expect(
			backupRestoreCommand(
				{
					stage: 'production',
					cwd: dir,
					from: 'imports/app.sql.gz',
					yes: true,
				},
				docker,
			),
		).rejects.toMatchObject({
			name: 'ImportNeedsDatabase',
			known: ['database'],
		});
		await expect(
			backupRestoreCommand(
				{
					stage: 'production',
					cwd: dir,
					from: 'imports/app.sql.gz',
					latest: true,
					database: 'database',
				},
				docker,
			),
		).rejects.toBeInstanceOf(BackupRunNotChosen);
		expect(calls).toEqual([]);
	});

	it('backup:restore asks at a terminal, and says how to skip asking where there is none', async () => {
		const { docker, calls } = fakeDocker();
		await expect(
			backupRestoreCommand(
				{
					stage: 'production',
					cwd: dir,
					latest: true,
					database: 'database',
				},
				docker,
			),
		).rejects.toMatchObject({
			name: 'PromptNeedsTerminal',
			message: expect.stringContaining('Pass --yes to restore without asking.'),
		});
		expect(calls.map((c) => c.op)).toEqual(['container']);
	});
});
