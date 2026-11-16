/**
 * The runner's point-in-time recovery, in this process: a base backup, the
 * health check's reading of the archiver, the restore that fetches a base
 * backup and replays to a moment, and the swap that puts it in place.
 *
 * The programs it starts — `wal-g`, `postgres`, `psql`, `pg_dump` — are
 * stand-ins first on `PATH`, the same names, recording what they were asked
 * and answering as the real ones do, since what is under test is what the
 * runner asks of them and does with their answers. The real ones are the
 * e2e suite's.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';

type Runner = typeof import('../runner');

let runner: Runner;
let dir: string;
let stateDir: string;
let bin: string;
let calls: string;
let data: string;

/** Every line the runner logs while `run` runs. */
async function reported<T>(
	run: () => Promise<T>,
): Promise<{ result: T; lines: Record<string, unknown>[] }> {
	const lines: Record<string, unknown>[] = [];
	const stop = runner.onReport((line) => lines.push(line));
	const quiet = [
		vi.spyOn(process.stdout, 'write').mockReturnValue(true),
		vi.spyOn(process.stderr, 'write').mockReturnValue(true),
	];
	try {
		return { result: await run(), lines };
	} finally {
		stop();
		for (const spy of quiet) spy.mockRestore();
	}
}

/** What the stand-ins were asked, one line each: `<program> <args>`. */
function asked(): string[] {
	return existsSync(calls)
		? readFileSync(calls, 'utf-8').split('\n').filter(Boolean)
		: [];
}

function standIn(name: string, script: string): void {
	writeFileSync(join(bin, name), `#!/bin/sh\n${script}`, { mode: 0o755 });
}

beforeAll(async () => {
	dir = await createTempDir('gkm-backups-pitr-runner-');
	stateDir = join(dir, 'state');
	bin = join(dir, 'bin');
	calls = join(dir, 'calls.log');
	data = join(dir, 'pg', 'data');
	mkdirSync(bin);
	vi.stubEnv('BACKUPS_STATE_DIR', stateDir);
	vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
	vi.stubEnv('CALLS', calls);
	runner = await import('../runner');

	// wal-g: pushes, lists what FAKE_BACKUP_LIST says, fetches a cluster.
	standIn(
		'wal-g',
		`echo "wal-g $* PGDATABASE=$PGDATABASE WALG_S3_PREFIX=$WALG_S3_PREFIX" >> "$CALLS"
case "$1" in
  backup-push)
    if [ -n "$FAKE_WALG_FAIL" ]; then echo "ERROR: $FAKE_WALG_FAIL" >&2; exit 1; fi ;;
  backup-list) printf '%s' "$FAKE_BACKUP_LIST" ;;
  backup-fetch) mkdir -p "$2" && echo 18 > "$2/PG_VERSION" && echo "$3" > "$2/fetched" ;;
esac
`,
	);
	// postgres: runs until it is told to stop — or dies, as recovery does
	// when the WAL runs out before the target.
	standIn(
		'postgres',
		`trap 'echo "postgres stopped" >> "$CALLS"; exit 0' INT TERM
echo "postgres $*" >> "$CALLS"
if [ -n "$FAKE_POSTGRES_FAIL" ]; then echo "FATAL:  $FAKE_POSTGRES_FAIL" >&2; exit 1; fi
touch "$CALLS.up"
while :; do sleep 0.05; done
`,
	);
	// psql: the archiver's row, out of recovery once Postgres is up — refused
	// before, as a socket nobody listens on is — and every load recorded.
	standIn(
		'psql',
		`case "$*" in
  *pg_stat_archiver*) printf '%s\\n' "$FAKE_ARCHIVER" ;;
  *pg_is_in_recovery*)
    if [ -f "$CALLS.up" ]; then echo f; else echo "psql: error: no socket" >&2; exit 2; fi ;;
  *ON_ERROR_STOP*-c*) echo "psql $* PGHOST=$PGHOST" >> "$CALLS" ;;
  *) echo "psql $* PGHOST=$PGHOST" >> "$CALLS"; cat > "$CALLS.loaded" ;;
esac
`,
	);
	standIn(
		'pg_dump',
		`echo "pg_dump $* PGUSER=$PGUSER" >> "$CALLS"
for last; do :; done
echo "-- dump of $last"
`,
	);
});

beforeEach(() => {
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(calls, { force: true });
	rmSync(`${calls}.up`, { force: true });
	rmSync(join(dir, 'pg'), { recursive: true, force: true });
	mkdirSync(stateDir, { recursive: true });
	vi.stubEnv('PGDATA', data);
	vi.stubEnv('PGDATABASE', '');
	vi.stubEnv('WALG_S3_PREFIX', 's3://bucket/gkm/shop/prod/backups/pitr');
	vi.stubEnv('FAKE_WALG_FAIL', '');
	vi.stubEnv('FAKE_POSTGRES_FAIL', '');
	vi.stubEnv('RECOVER_INTO', '');
});

afterAll(async () => {
	vi.unstubAllEnvs();
	await cleanupDir(dir);
});

describe('a base backup', () => {
	it('pushes the data directory through WAL-G, connected to the cluster’s own database', async () => {
		const { result, lines } = await reported(() => runner.main('base'));

		expect(result).toBe(0);
		expect(asked()).toEqual([
			`wal-g backup-push ${data} PGDATABASE=postgres WALG_S3_PREFIX=s3://bucket/gkm/shop/prod/backups/pitr`,
		]);
		expect(lines).toEqual([
			expect.objectContaining({
				level: 'info',
				msg: 'base backup finished',
				ok: true,
				prefix: 's3://bucket/gkm/shop/prod/backups/pitr',
			}),
		]);
		// What the health check counts the next one from.
		expect(
			Number(readFileSync(join(stateDir, 'last-base'), 'utf-8')),
		).toBeGreaterThan(Date.now() - 60_000);
	});

	it('fails with what WAL-G said, and records no success', async () => {
		vi.stubEnv(
			'FAKE_WALG_FAIL',
			'permission denied for function pg_backup_start',
		);
		const { result, lines } = await reported(() => runner.main('base'));

		expect(result).toBe(1);
		expect(lines).toEqual([
			expect.objectContaining({
				level: 'error',
				msg: 'base backup failed',
				error: expect.stringContaining(
					'permission denied for function pg_backup_start',
				),
			}),
		]);
		expect(existsSync(join(stateDir, 'last-base'))).toBe(false);
	});
});

describe('the archiver, as the health check reads it', () => {
	it.each([
		[
			'keeping up',
			{
				sinceArchived: 30,
				failedCount: 0,
				failing: false,
				oldestWaiting: null,
			},
			undefined,
		],
		[
			'quiet: nothing written, nothing waiting',
			{
				sinceArchived: 86_400,
				failedCount: 0,
				failing: false,
				oldestWaiting: null,
			},
			undefined,
		],
		[
			'a segment waiting under five minutes',
			{
				sinceArchived: 400,
				failedCount: 0,
				failing: false,
				oldestWaiting: 120,
			},
			undefined,
		],
		[
			'a segment waiting over five minutes',
			{
				sinceArchived: 400,
				failedCount: 0,
				failing: false,
				oldestWaiting: 360,
			},
			'a WAL segment has waited 360s to be archived; the last was archived 400s ago',
		],
		[
			'failing now',
			{ sinceArchived: 400, failedCount: 3, failing: true, oldestWaiting: 60 },
			'archive_command is failing (3 failures; the last attempt failed)',
		],
		[
			'failed once, since recovered',
			{
				sinceArchived: 10,
				failedCount: 3,
				failing: false,
				oldestWaiting: null,
			},
			undefined,
		],
	])('is %s', (_, state, verdict) => {
		expect(runner.archiverVerdict(state)).toBe(verdict);
	});

	it('reads pg_stat_archiver and the waiting segments through psql', async () => {
		vi.stubEnv('FAKE_ARCHIVER', '42|2|f|310');
		expect(await runner.readArchiver()).toEqual({
			sinceArchived: 42,
			failedCount: 2,
			failing: false,
			oldestWaiting: 310,
		});
		vi.stubEnv('FAKE_ARCHIVER', '|0|f|');
		expect(await runner.readArchiver()).toEqual({
			sinceArchived: null,
			failedCount: 0,
			failing: false,
			oldestWaiting: null,
		});
	});
});

describe('the health check, with point-in-time recovery', () => {
	const GAP = 86_400;
	const BASE = 6 * 3600;

	beforeEach(() => {
		vi.stubEnv('BACKUPS_MAX_GAP_SECONDS', String(GAP));
		vi.stubEnv(
			'PITR_BASE_SCHEDULE',
			JSON.stringify({ kind: 'every', seconds: BASE, offset: 7200 }),
		);
		vi.stubEnv('PITR_BASE_MAX_GAP_SECONDS', String(BASE));
		vi.stubEnv('FAKE_ARCHIVER', '20|0|f|');
	});

	it('counts the last base backup by its own interval', () => {
		const now = Date.UTC(2026, 10, 16);
		writeFileSync(join(stateDir, 'last-success'), String(now));
		writeFileSync(join(stateDir, 'last-base'), String(now));
		expect(runner.healthy(now + (2 * BASE + 15 * 60) * 1000)).toBe(true);
		expect(runner.healthy(now + (2 * BASE + 15 * 60 + 1) * 1000)).toBe(false);
	});

	it('is unhealthy when archiving fails, though every backup is recent', async () => {
		writeFileSync(join(stateDir, 'last-success'), String(Date.now()));
		writeFileSync(join(stateDir, 'last-base'), String(Date.now()));
		expect((await reported(() => runner.main('health'))).result).toBe(0);
		vi.stubEnv('FAKE_ARCHIVER', '900|5|t|840');
		expect((await reported(() => runner.main('health'))).result).toBe(1);
	});
});

describe('choosing the base backup to replay from', () => {
	const backups = [
		{ backup_name: 'base_B', finish_time: '2026-11-15T02:10:00Z' },
		{ backup_name: 'base_A', finish_time: '2026-11-14T02:10:00Z' },
		{ backup_name: 'base_C', finish_time: '2026-11-16T02:10:00Z' },
	];

	it('takes the newest that had finished by the moment', () => {
		expect(
			runner.chooseBase(backups, new Date('2026-11-15T09:00:00Z')).backup_name,
		).toBe('base_B');
		expect(
			runner.chooseBase(backups, new Date('2026-11-15T02:10:00Z')).backup_name,
		).toBe('base_B');
	});

	it('refuses a moment before the first had finished, naming when it did', () => {
		expect(() =>
			runner.chooseBase(backups, new Date('2026-11-14T02:09:59Z')),
		).toThrow(/earliest finished at 2026-11-14T02:10:00Z/);
		expect(() => runner.chooseBase([], new Date())).toThrow(
			/gkm backup:now --base/,
		);
	});

	it('names the moment as Postgres reads it', () => {
		expect(
			runner.recoveryTargetTime(new Date('2026-11-16T09:41:07.250Z')),
		).toBe('2026-11-16 09:41:07.250+00');
	});
});

describe('a restore to a moment', () => {
	const LIST = JSON.stringify([
		{ backup_name: 'base_A', finish_time: '2026-11-14T02:10:00Z' },
		{ backup_name: 'base_B', finish_time: '2026-11-15T02:10:00Z' },
	]);

	beforeEach(() => {
		vi.stubEnv('FAKE_BACKUP_LIST', LIST);
		vi.stubEnv('RECOVER_TARGET', '2026-11-15T09:41:00.000Z');
		vi.stubEnv('RECOVER_SUPERUSER', 'shop_admin');
		vi.stubEnv('PGHOST', 'postgres');
		vi.stubEnv(
			'RECOVER_DATABASES',
			JSON.stringify([
				{ file: 'auth-database', name: 'auth_database_prod' },
				{ file: 'database', name: 'database_prod' },
			]),
		);
	});

	it('fetches the base backup beside the live cluster, replays to the moment, promotes and stops', async () => {
		const { result, lines } = await reported(() => runner.main('recover'));
		const restored = `${data}.gkm-restore`;

		expect(result).toBe(0);
		expect(readFileSync(join(restored, 'fetched'), 'utf-8').trim()).toBe(
			'base_B',
		);
		expect(existsSync(join(restored, 'recovery.signal'))).toBe(true);
		const started = asked().find((line) => line.startsWith('postgres '));
		expect(started).toContain(`-D ${restored}`);
		expect(started).toContain('restore_command=wal-g wal-fetch %f %p');
		expect(started).toContain(
			'recovery_target_time=2026-11-15 09:41:00.000+00',
		);
		expect(started).toContain('recovery_target_action=promote');
		// Its new timeline is archived: it is about to become the live one.
		expect(started).toContain('archive_mode=on');
		expect(started).toContain('listen_addresses=');
		expect(asked().at(-1)).toBe('postgres stopped');
		expect(lines.map((l) => l.msg)).toEqual([
			'fetching base backup',
			'recovered',
		]);
	});

	it('copies each database into <into>_<database> on the live cluster, archives nothing, and keeps nothing', async () => {
		vi.stubEnv('RECOVER_INTO', 'drill');
		const { result } = await reported(() => runner.main('recover'));

		expect(result).toBe(0);
		const lines = asked();
		expect(lines.find((l) => l.startsWith('postgres '))).toContain(
			'archive_mode=off',
		);
		expect(lines.filter((l) => l.startsWith('psql '))).toEqual([
			expect.stringContaining(
				'DROP DATABASE IF EXISTS "drill_auth_database" WITH (FORCE)',
			),
			expect.stringContaining('CREATE DATABASE "drill_auth_database"'),
			expect.stringMatching(/-d drill_auth_database .*PGHOST=postgres$/),
			expect.stringContaining(
				'DROP DATABASE IF EXISTS "drill_database" WITH (FORCE)',
			),
			expect.stringContaining('CREATE DATABASE "drill_database"'),
			expect.stringMatching(/-d drill_database .*PGHOST=postgres$/),
		]);
		expect(lines.filter((l) => l.startsWith('pg_dump '))).toEqual([
			'pg_dump -h /tmp --format=plain --dbname auth_database_prod PGUSER=shop_admin',
			'pg_dump -h /tmp --format=plain --dbname database_prod PGUSER=shop_admin',
		]);
		expect(readFileSync(`${calls}.loaded`, 'utf-8')).toBe(
			'-- dump of database_prod\n',
		);
		expect(existsSync('/tmp/gkm-recover/data')).toBe(false);
		expect(existsSync(`${data}.gkm-restore`)).toBe(false);
	});

	it('fails with what Postgres said when the WAL runs out before the moment', async () => {
		vi.stubEnv(
			'FAKE_POSTGRES_FAIL',
			'recovery ended before configured recovery target was reached',
		);
		await expect(reported(() => runner.main('recover'))).rejects.toThrow(
			/recovery ended before configured recovery target/,
		);
	});

	it('refuses a moment before every base backup, fetching nothing', async () => {
		vi.stubEnv('RECOVER_TARGET', '2026-11-13T00:00:00.000Z');
		await expect(reported(() => runner.main('recover'))).rejects.toThrow(
			/No base backup finished at or before 2026-11-13T00:00:00\.000Z/,
		);
		expect(asked().some((l) => l.includes('backup-fetch'))).toBe(false);
	});
});

describe('the swap', () => {
	function cluster(path: string, marker: string) {
		mkdirSync(path, { recursive: true });
		writeFileSync(join(path, 'PG_VERSION'), '18');
		writeFileSync(join(path, 'marker'), marker);
	}
	const marker = (path: string) => readFileSync(join(path, 'marker'), 'utf-8');

	it('puts the recovered cluster in place, keeping the live one beside it until the next', async () => {
		cluster(data, 'live');
		cluster(`${data}.gkm-restore`, 'recovered');
		expect((await reported(() => runner.main('swap'))).result).toBe(0);
		expect(marker(data)).toBe('recovered');
		expect(marker(`${data}.gkm-previous`)).toBe('live');
		expect(existsSync(`${data}.gkm-restore`)).toBe(false);

		cluster(`${data}.gkm-restore`, 'again');
		await reported(() => runner.main('swap'));
		expect(marker(data)).toBe('again');
		expect(marker(`${data}.gkm-previous`)).toBe('recovered');
	});

	it('leaves the live cluster alone when nothing was recovered', async () => {
		cluster(data, 'live');
		await expect(reported(() => runner.main('swap'))).rejects.toThrow(
			/no recovered cluster/,
		);
		expect(marker(data)).toBe('live');
	});
});
