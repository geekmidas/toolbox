/**
 * The backups container's runner, in this process: its SigV4 signature
 * against AWS's own worked example, its uploads against the AWS emulator the
 * suite runs (floci), a run of several databases into one folder, its log
 * lines, and its health.
 *
 * `pg_dump` is the one program the runner starts. Where a `pg_dump` of the
 * test Postgres's major is installed, a run dumps a real database through
 * it; the rest put a stand-in for it first on `PATH` — the same program
 * name, printing a dump or failing as `pg_dump` does — since what is under
 * test is what the runner does with what it is handed. The image's real
 * `pg_dump` is the e2e suite's.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
	CreateBucketCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	S3Client,
} from '@aws-sdk/client-s3';
import * as s3Url from '@geekmidas/storage/s3-url';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { Client } from 'pg';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL, POSTGRES_PORT } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { removeBucket } from './__helpers__/bucket';

type Runner = typeof import('../runner');

const REGION = 'eu-west-1';
const BUCKET = `gkm-runner-${Date.now().toString(36)}`;
/** Parts this small, so a few kilobytes take a multipart upload. */
const PART_BYTES = 1024;

const s3 = new S3Client({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

/** What S3 answers, where a test needs it to answer otherwise than floci. */
const FAKE_S3 = 'http://s3.runner.test';
const requests: { method: string; url: string }[] = [];
const server = setupServer();

let runner: Runner;
let dir: string;
let stateDir: string;
let bin: string;

const toEmulator = () =>
	s3Url.build({
		bucket: BUCKET,
		region: REGION,
		endpoint: LOCALSTACK_URL,
		forcePathStyle: true,
		accessKeyId: 'test',
		secretAccessKey: 'test',
	});

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

async function* chunks(...parts: (string | Buffer)[]) {
	for (const part of parts) yield Buffer.from(part);
}

async function body(Key: string): Promise<Buffer> {
	const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
	return Buffer.from(await object.Body!.transformToByteArray());
}

async function keys(prefix: string): Promise<string[]> {
	const listed = await s3.send(
		new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }),
	);
	return (listed.Contents ?? []).map((o) => o.Key!).sort();
}

/**
 * `pg_dump`, first on `PATH`: prints a dump of the database it is asked for
 * — `FAKE_DUMP_KB` kilobytes of it — or, for the one `FAKE_DUMP_FAIL` names,
 * fails the way `pg_dump` does.
 */
function standInPgDump(): void {
	const script = `#!/bin/sh
for last; do :; done
if [ "$last" = "$FAKE_DUMP_FAIL" ]; then
  echo "pg_dump: error: database \\"$last\\" does not exist" >&2
  exit 1
fi
echo "-- PostgreSQL database dump of $last"
if [ -n "$FAKE_DUMP_KB" ]; then
  dd if=/dev/urandom bs=1024 count="$FAKE_DUMP_KB" 2>/dev/null | od -An -x
fi
echo "-- args: $*"
`;
	writeFileSync(join(bin, 'pg_dump'), script, { mode: 0o755 });
	vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
}

/** Whether a `pg_dump` that can dump the test Postgres is installed. */
function realPgDump(): boolean {
	try {
		const version = execFileSync('pg_dump', ['--version'], {
			encoding: 'utf-8',
		});
		return Number(/(\d+)\.\d+/.exec(version)?.[1] ?? 0) >= 18;
	} catch {
		return false;
	}
}
const HAS_PG_DUMP = realPgDump();

beforeAll(async () => {
	dir = await createTempDir('gkm-backups-runner-');
	stateDir = join(dir, 'state');
	bin = join(dir, 'bin');
	mkdirSync(bin);
	vi.stubEnv('BACKUPS_STATE_DIR', stateDir);
	vi.stubEnv('BACKUPS_PART_BYTES', String(PART_BYTES));
	runner = await import('../runner');
	server.listen({ onUnhandledRequest: 'bypass' });
	server.events.on('request:start', ({ request }) => {
		if (!request.url.startsWith(FAKE_S3)) return;
		requests.push({ method: request.method, url: request.url });
	});
	await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
});

beforeEach(() => {
	requests.length = 0;
	rmSync(stateDir, { recursive: true, force: true });
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(async () => {
	server.close();
	vi.unstubAllEnvs();
	await removeBucket(s3, BUCKET);
	await cleanupDir(dir);
});

describe('the SigV4 signature', () => {
	it("is AWS's own for its worked PUT Object example", async () => {
		let authorization = '';
		server.use(
			http.put('https://examplebucket.s3.amazonaws.com/*', ({ request }) => {
				authorization = request.headers.get('authorization') ?? '';
				return new HttpResponse(null, { status: 200 });
			}),
		);

		await runner.s3Send(
			{
				bucket: 'examplebucket',
				region: 'us-east-1',
				endpoint: 'https://s3.amazonaws.com',
				forcePathStyle: false,
				accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
				secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
			},
			{
				method: 'PUT',
				key: 'test$file.text',
				body: Buffer.from('Welcome to Amazon S3.'),
				headers: {
					Date: 'Fri, 24 May 2013 00:00:00 GMT',
					'x-amz-storage-class': 'REDUCED_REDUNDANCY',
				},
			},
			new Date('2013-05-24T00:00:00Z'),
		);

		expect(authorization).toBe(
			'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
				'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, ' +
				'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
		);
	});

	it("addresses a bucket by its virtual host on AWS, and signs the query's parameters in order", async () => {
		let seen = '';
		server.use(
			http.post('https://acme.s3.eu-west-1.amazonaws.com/*', ({ request }) => {
				seen = request.url;
				return new HttpResponse('<x/>', { status: 200 });
			}),
		);
		const answer = await runner.s3Send(
			runner.destination('s3://K:S@acme?region=eu-west-1'),
			{ method: 'POST', key: 'a b/c', query: { uploads: '', b: '1' } },
		);
		expect(answer.status).toBe(200);
		expect(seen).toBe(
			'https://acme.s3.eu-west-1.amazonaws.com/a%20b/c?b=1&uploads=',
		);
	});
});

describe('BACKUPS_URL, read', () => {
	it('is the bucket, region, endpoint and key the deploy wrote', () => {
		expect(runner.destination(toEmulator())).toEqual({
			bucket: BUCKET,
			region: REGION,
			endpoint: LOCALSTACK_URL,
			forcePathStyle: true,
			accessKeyId: 'test',
			secretAccessKey: 'test',
		});
		expect(runner.destination('s3://K%2B:S%2F@b')).toMatchObject({
			region: 'us-east-1',
			forcePathStyle: false,
			accessKeyId: 'K+',
			secretAccessKey: 'S/',
		});
	});

	it('is refused when it is not an s3:// URL', () => {
		expect(() => runner.destination('https://example.com/b')).toThrow(
			/BACKUPS_URL is not an s3:\/\/ URL/,
		);
	});
});

describe('an upload', () => {
	it('is one PUT when it fits in a part', async () => {
		const to = runner.destination(toEmulator());
		const size = await runner.upload(to, 'small/one.sql.gz', chunks('a', 'b'));
		expect(size).toBe(2);
		expect((await body('small/one.sql.gz')).toString()).toBe('ab');
	});

	it('is uploaded in parts, in order, when it does not', async () => {
		const to = runner.destination(toEmulator());
		const data = Buffer.from(
			Array.from({ length: 3500 }, (_, i) =>
				String.fromCharCode(65 + (i % 26)),
			).join(''),
		);
		const size = await runner.upload(
			to,
			'large/many.sql.gz',
			chunks(
				data.subarray(0, 1500),
				data.subarray(1500, 3000),
				data.subarray(3000),
			),
		);
		expect(size).toBe(3500);
		expect(await body('large/many.sql.gz')).toEqual(data);
	});

	it('is never put when what made it failed — whole or in parts', async () => {
		const to = runner.destination(toEmulator());
		const failed = Promise.reject(new Error('pg_dump exited 1'));
		failed.catch(() => {});
		await expect(
			runner.upload(to, 'failed/small.sql.gz', chunks('half a dump'), failed),
		).rejects.toThrow('pg_dump exited 1');
		await expect(
			runner.upload(
				to,
				'failed/large.sql.gz',
				chunks(Buffer.alloc(3000, 1)),
				failed,
			),
		).rejects.toThrow('pg_dump exited 1');
		expect(await keys('failed/')).toEqual([]);
	});

	it('stops at a part S3 refuses, and never completes the upload', async () => {
		server.use(
			http.post(`${FAKE_S3}/b/k`, ({ request }) =>
				new URL(request.url).searchParams.has('uploads')
					? HttpResponse.text(
							'<InitiateMultipartUploadResult><UploadId>u-1</UploadId></InitiateMultipartUploadResult>',
						)
					: HttpResponse.text('<Complete/>'),
			),
			http.put(
				`${FAKE_S3}/b/k`,
				() =>
					new HttpResponse('<Error><Code>AccessDenied</Code></Error>', {
						status: 403,
					}),
			),
		);
		const to = runner.destination(
			`s3://K:S@b?region=${REGION}&endpoint=${encodeURIComponent(FAKE_S3)}&forcePathStyle=true`,
		);

		await expect(
			runner.upload(to, 'k', chunks(Buffer.alloc(PART_BYTES * 2, 7))),
		).rejects.toMatchObject({
			name: 'UploadFailed',
			status: 403,
			message: expect.stringContaining('AccessDenied'),
		});
		expect(requests.map((r) => `${r.method} ${new URL(r.url).search}`)).toEqual(
			['POST ?uploads=', 'PUT ?partNumber=1&uploadId=u-1'],
		);
	});

	it('asks again when S3 fails, and fails on an error in a 200', async () => {
		let puts = 0;
		let completed = '';
		server.use(
			http.post(`${FAKE_S3}/b/k`, async ({ request }) => {
				if (new URL(request.url).searchParams.has('uploads')) {
					return HttpResponse.text('<UploadId>u-2</UploadId>');
				}
				completed = await request.text();
				return HttpResponse.text('<Error><Code>InternalError</Code></Error>');
			}),
			http.put(`${FAKE_S3}/b/k`, () => {
				puts++;
				return puts === 1
					? new HttpResponse('slow down', { status: 503 })
					: new HttpResponse(null, {
							status: 200,
							headers: { etag: `"e${puts}"` },
						});
			}),
		);
		const to = runner.destination(
			`s3://K:S@b?region=${REGION}&endpoint=${encodeURIComponent(FAKE_S3)}&forcePathStyle=true`,
		);

		await expect(
			runner.upload(to, 'k', chunks(Buffer.alloc(PART_BYTES + 10, 7))),
		).rejects.toMatchObject({ name: 'UploadFailed', status: 200 });
		expect(puts).toBe(2);
		expect(completed).toBe(
			'<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"e2"</ETag></Part></CompleteMultipartUpload>',
		);
	}, 15_000);

	it('asks again when the network fails, and encodes every reserved character of a key', async () => {
		let attempts = 0;
		let path = '';
		server.use(
			http.put(`${FAKE_S3}/b/*`, ({ request }) => {
				attempts++;
				path = new URL(request.url).pathname;
				return attempts === 1
					? HttpResponse.error()
					: new HttpResponse(null, { status: 200 });
			}),
		);
		const to = runner.destination(
			`s3://K:S@b?endpoint=${encodeURIComponent(FAKE_S3)}&forcePathStyle=true`,
		);
		expect(await runner.upload(to, "it's (done)!*.sql.gz", chunks('x'))).toBe(
			1,
		);
		expect(attempts).toBe(2);
		expect(path).toBe('/b/it%27s%20%28done%29%21%2A.sql.gz');
	}, 15_000);

	it('addresses a bucket by its virtual host on an endpoint that takes it', async () => {
		let host = '';
		server.use(
			http.put('http://b.s3.runner.test/k', ({ request }) => {
				host = new URL(request.url).host;
				return new HttpResponse(null, { status: 200 });
			}),
		);
		await runner.upload(
			runner.destination(`s3://K:S@b?endpoint=${encodeURIComponent(FAKE_S3)}`),
			'k',
			chunks('x'),
		);
		expect(host).toBe('b.s3.runner.test');
	});

	it('fails when S3 never says which upload it started', async () => {
		server.use(
			http.post(`${FAKE_S3}/b/k`, () => HttpResponse.text('<nothing/>')),
		);
		const to = runner.destination(
			`s3://K:S@b?endpoint=${encodeURIComponent(FAKE_S3)}&forcePathStyle=true`,
		);
		await expect(
			runner.upload(to, 'k', chunks(Buffer.alloc(PART_BYTES, 1))),
		).rejects.toMatchObject({ name: 'UploadFailed' });
	});
});

describe('a run', () => {
	const PREFIX = 'gkm/shop/production/backups';

	beforeEach(() => {
		standInPgDump();
		vi.stubEnv('BACKUPS_URL', toEmulator());
		vi.stubEnv('BACKUPS_PREFIX', `${PREFIX}/`);
		vi.stubEnv(
			'BACKUPS_DATABASES',
			JSON.stringify([
				{ file: 'database', name: 'database_production' },
				{ file: 'auth-database', name: 'auth_database_production' },
			]),
		);
		vi.stubEnv('FAKE_DUMP_FAIL', '');
		vi.stubEnv('FAKE_DUMP_KB', '');
	});

	it("dumps every database into the run's one folder, gzipped, and logs one line", async () => {
		vi.stubEnv('FAKE_DUMP_KB', '4');
		const { result: ok, lines } = await reported(() =>
			runner.backupOnce(new Date('2026-10-10T02:00:00Z')),
		);
		expect(ok).toBe(true);

		const folder = `${PREFIX}/2026-10-10/02-00-00Z`;
		expect(await keys(`${folder}/`)).toEqual([
			`${folder}/auth-database.sql.gz`,
			`${folder}/database.sql.gz`,
		]);
		const dump = gunzipSync(await body(`${folder}/database.sql.gz`)).toString();
		expect(dump).toContain(
			'-- PostgreSQL database dump of database_production',
		);
		expect(dump).toContain(
			'--format=plain --create --clean --if-exists --dbname database_production',
		);

		expect(lines).toEqual([
			{
				time: expect.any(String),
				level: 'info',
				msg: 'backup finished',
				ok: true,
				folder,
				databases: ['database', 'auth-database'],
				bytes: {
					database: expect.any(Number),
					'auth-database': expect.any(Number),
				},
				durationMs: expect.any(Number),
			},
		]);
		expect(readFileSync(join(stateDir, 'last-folder'), 'utf-8')).toBe(
			'2026-10-10/02-00-00Z',
		);
		expect(
			Number(readFileSync(join(stateDir, 'last-success'), 'utf-8')),
		).toBeGreaterThan(0);
	});

	it('names the database that failed, puts the others, and counts as no good run', async () => {
		vi.stubEnv('FAKE_DUMP_FAIL', 'auth_database_production');
		const { result: ok, lines } = await reported(() =>
			runner.backupOnce(new Date('2026-10-11T02:00:00Z')),
		);
		expect(ok).toBe(false);

		const folder = `${PREFIX}/2026-10-11/02-00-00Z`;
		expect(await keys(`${folder}/`)).toEqual([`${folder}/database.sql.gz`]);
		expect(lines[0]).toMatchObject({
			level: 'error',
			msg: 'backup failed',
			ok: false,
			folder,
			failed: {
				'auth-database': expect.stringContaining(
					'pg_dump auth_database_production exited 1',
				),
			},
		});
		expect(() => readFileSync(join(stateDir, 'last-success'))).toThrow();
	});

	it('never writes a run over the last one in the same second', async () => {
		const at = new Date();
		await reported(async () => {
			await runner.backupOnce(at);
			await runner.backupOnce(at);
		});
		const fixed = ['2026-10-10/02-00-00Z', '2026-10-11/02-00-00Z'];
		const folders = new Set(
			(await keys(`${PREFIX}/`))
				.map((key) => key.split('/').slice(4, 6).join('/'))
				.filter((f) => !fixed.includes(f)),
		);
		expect(folders.size).toBe(2);
	});

	it('sends its line to the stage telemetry as an OTLP log, when it is on', async () => {
		let sent: { headers: Headers; body: unknown } | undefined;
		server.use(
			http.post('http://otel.runner.test/v1/logs', async ({ request }) => {
				sent = { headers: request.headers, body: await request.json() };
				return HttpResponse.json({});
			}),
		);
		vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel.runner.test/');
		vi.stubEnv(
			'OTEL_EXPORTER_OTLP_HEADERS',
			'Authorization=Basic%20abc, x-org = acme',
		);
		vi.stubEnv('OTEL_SERVICE_NAME', 'backups');
		try {
			await reported(() => runner.backupOnce(new Date('2026-10-12T02:00:00Z')));
		} finally {
			vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
		}

		expect(sent?.headers.get('authorization')).toBe('Basic abc');
		expect(sent?.headers.get('x-org')).toBe('acme');
		const record = (sent?.body as any).resourceLogs[0];
		expect(record.resource.attributes).toEqual([
			{ key: 'service.name', value: { stringValue: 'backups' } },
		]);
		const log = record.scopeLogs[0].logRecords[0];
		expect(log).toMatchObject({
			severityText: 'INFO',
			severityNumber: 9,
			body: { stringValue: 'backup finished' },
		});
		const attributes = Object.fromEntries(
			log.attributes.map((a: { key: string; value: unknown }) => [
				a.key,
				a.value,
			]),
		);
		expect(attributes).toMatchObject({
			ok: { boolValue: true },
			folder: { stringValue: `${PREFIX}/2026-10-12/02-00-00Z` },
			durationMs: { doubleValue: expect.any(Number) },
			databases: { stringValue: '["database","auth-database"]' },
		});
	});

	it('waits for a run already going, rather than dumping beside it', async () => {
		const started = Date.now();
		const [first, second] = await reported(() =>
			Promise.all([
				runner.backupOnce(new Date('2026-10-14T02:00:00Z')),
				runner.backupOnce(new Date('2026-10-15T02:00:00Z')),
			]),
		).then(({ result }) => result);
		expect(first).toBe(true);
		expect(second).toBe(true);
		// The second took the lock only once the first let it go.
		expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
		expect(await keys(`${PREFIX}/2026-10-15/`)).toHaveLength(2);
	}, 15_000);

	it('says which variable it is missing', async () => {
		vi.stubEnv('BACKUPS_URL', '');
		await expect(runner.backupOnce()).rejects.toMatchObject({
			name: 'BackupsEnvInvalid',
			message: expect.stringContaining('BACKUPS_URL is not set'),
		});
	});

	it.runIf(HAS_PG_DUMP)(
		'dumps a real database with the real pg_dump',
		async () => {
			vi.stubEnv('PATH', process.env.PATH!.replaceAll(`${bin}:`, ''));
			const name = `gkm_runner_${Date.now().toString(36)}`;
			const admin = new Client({
				host: 'localhost',
				port: POSTGRES_PORT,
				user: 'geekmidas',
				password: 'geekmidas',
				database: 'postgres',
			});
			await admin.connect();
			try {
				await admin.query(`CREATE DATABASE ${name}`);
				vi.stubEnv('PGHOST', 'localhost');
				vi.stubEnv('PGPORT', String(POSTGRES_PORT));
				vi.stubEnv('PGUSER', 'geekmidas');
				vi.stubEnv('PGPASSWORD', 'geekmidas');
				vi.stubEnv(
					'BACKUPS_DATABASES',
					JSON.stringify([{ file: 'real', name }]),
				);
				const { result } = await reported(() =>
					runner.backupOnce(new Date('2026-10-13T02:00:00Z')),
				);
				expect(result).toBe(true);
				const dump = gunzipSync(
					await body(`${PREFIX}/2026-10-13/02-00-00Z/real.sql.gz`),
				).toString();
				expect(dump).toContain(`CREATE DATABASE ${name}`);
			} finally {
				await admin.query(`DROP DATABASE IF EXISTS ${name}`);
				await admin.end();
			}
		},
	);
});

describe('the health check', () => {
	const GAP = 6 * 3600;

	beforeEach(() => {
		vi.stubEnv('BACKUPS_MAX_GAP_SECONDS', String(GAP));
		mkdirSync(stateDir, { recursive: true });
	});

	it('is unhealthy before the runner has even started', () => {
		expect(runner.healthy()).toBe(false);
	});

	it('is healthy in its grace after a start with no run yet, and not after', () => {
		const started = Date.UTC(2026, 9, 10);
		writeFileSync(join(stateDir, 'started'), String(started));
		const limit = started + (2 * GAP + 15 * 60) * 1000;
		expect(runner.healthy(limit)).toBe(true);
		expect(runner.healthy(limit + 1)).toBe(false);
	});

	it('counts from the last good run once there is one', () => {
		const started = Date.UTC(2026, 9, 1);
		const success = Date.UTC(2026, 9, 10);
		writeFileSync(join(stateDir, 'started'), String(started));
		writeFileSync(join(stateDir, 'last-success'), String(success));
		expect(runner.healthy(success + 2 * GAP * 1000)).toBe(true);
		expect(runner.healthy(success + (2 * GAP + 15 * 60 + 1) * 1000)).toBe(
			false,
		);
	});

	it('is what `health` exits with', async () => {
		writeFileSync(join(stateDir, 'last-success'), String(Date.now()));
		expect(await runner.main('health')).toBe(0);
		rmSync(join(stateDir, 'last-success'));
		expect(await runner.main('health')).toBe(1);
	});
});

describe('the program', () => {
	it('prints its usage for a command it does not know', async () => {
		const { result, lines } = await reported(() => runner.main('restore'));
		expect(result).toBe(2);
		expect(lines).toEqual([
			expect.objectContaining({
				level: 'error',
				msg: 'usage: backup.mjs serve | run | health',
				command: 'restore',
			}),
		]);
	});

	it('`run` exits 1 when a database fails, 0 when every one is put', async () => {
		standInPgDump();
		vi.stubEnv('BACKUPS_URL', toEmulator());
		vi.stubEnv('BACKUPS_PREFIX', 'gkm/shop/qa/backups');
		vi.stubEnv(
			'BACKUPS_DATABASES',
			JSON.stringify([{ file: 'database', name: 'database_qa' }]),
		);
		vi.stubEnv('FAKE_DUMP_FAIL', 'database_qa');
		expect((await reported(() => runner.main('run'))).result).toBe(1);
		vi.stubEnv('FAKE_DUMP_FAIL', '');
		expect((await reported(() => runner.main('run'))).result).toBe(0);
	});

	it('`serve` records its start, says when it runs next, and stops on a schedule that never runs', async () => {
		vi.stubEnv(
			'BACKUPS_SCHEDULE',
			JSON.stringify({
				kind: 'cron',
				minutes: [0],
				hours: [2],
				days: [30],
				months: [2],
				weekdays: null,
			}),
		);
		const { lines } = await reported(() => runner.serve());
		expect(
			Number(readFileSync(join(stateDir, 'started'), 'utf-8')),
		).toBeGreaterThan(0);
		expect(lines).toEqual([
			expect.objectContaining({ msg: 'backups scheduled', next: null }),
		]);
	});
});

describe("the runner's schedule", () => {
	const cron = (parts: Partial<Record<string, number[] | null>>) => ({
		kind: 'cron' as const,
		minutes: [0],
		hours: [2],
		days: null,
		months: null,
		weekdays: null,
		...parts,
	});

	it('takes a day of the month or of the week when a cron names both', () => {
		const schedule = cron({ days: [15], weekdays: [1] });
		// Thursday the 1st: the next Monday (the 5th) comes before the 15th.
		expect(runner.nextRun(schedule, new Date('2026-10-01T03:00:00Z'))).toEqual(
			new Date('2026-10-05T02:00:00Z'),
		);
		expect(runner.nextRun(schedule, new Date('2026-10-13T03:00:00Z'))).toEqual(
			new Date('2026-10-15T02:00:00Z'),
		);
	});

	it('keeps to its months and its days of the week alone', () => {
		expect(
			runner.nextRun(cron({ months: [1] }), new Date('2026-10-01T00:00:00Z')),
		).toEqual(new Date('2027-01-01T02:00:00Z'));
		expect(
			runner.nextRun(cron({ weekdays: [0] }), new Date('2026-10-09T00:00:00Z')),
		).toEqual(new Date('2026-10-11T02:00:00Z'));
		expect(
			runner.nextRun(cron({ days: [31] }), new Date('2026-11-01T00:00:00Z')),
		).toEqual(new Date('2026-12-31T02:00:00Z'));
	});

	it('runs an interval on its boundary, never the minute it was asked at', () => {
		const every = { kind: 'every' as const, seconds: 3600, offset: 7200 };
		expect(runner.nextRun(every, new Date('2026-10-10T05:00:00Z'))).toEqual(
			new Date('2026-10-10T06:00:00Z'),
		);
		expect(runner.nextRun(every, new Date('2026-10-10T05:59:59Z'))).toEqual(
			new Date('2026-10-10T06:00:00Z'),
		);
	});

	it('names each run by its UTC second', () => {
		expect(runner.runFolder(new Date('2026-01-02T03:04:05.678Z'))).toBe(
			'2026-01-02/03-04-05Z',
		);
	});
});
