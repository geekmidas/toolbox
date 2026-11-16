/**
 * The backups container's program: `pg_dump` each of the stack's databases
 * on schedule and stream it, gzipped, to the stage's backups prefix.
 *
 * It ships alone — copied into an image built `FROM postgres:<major>-alpine`
 * with Node added — so it imports nothing but Node's own modules: S3 is
 * spoken to with a SigV4 signature made here, not the AWS SDK.
 *
 *   node backup.mjs serve    run on schedule, forever (the container's command)
 *   node backup.mjs run      one backup now (`gkm backup:now`)
 *   node backup.mjs health   exit 1 when the last good run is too old
 *
 * With point-in-time recovery (`PITR_BASE_SCHEDULE` set), also:
 *
 *   node backup.mjs base     one base backup now (`gkm backup:now --base`)
 *   node backup.mjs recover  in a one-off container: fetch a base backup and
 *                            replay WAL to `RECOVER_TARGET` (`backup:restore --to`)
 *   node backup.mjs swap     in a one-off container, Postgres stopped: put the
 *                            recovered cluster in place of the live one
 *
 * and `serve` takes a base backup (`wal-g backup-push`) on its own schedule,
 * and `health` reads `pg_stat_archiver` too.
 *
 * Its key may only put objects under the prefix: it never reads, lists or
 * deletes, so nothing here does either — `recover` alone reads, and runs
 * with the caller's credentials, not the stage's key. A dump is uploaded in
 * parts as it is made, so no database is ever held on disk or in memory
 * whole.
 *
 * Environment:
 *
 * - `BACKUPS_URL` — `s3://KEY:SECRET@bucket?region=…`, the stage's backups key
 * - `BACKUPS_PREFIX` — `gkm/<project>/<stage>/backups`
 * - `BACKUPS_DATABASES` — `[{"file":"auth-database","name":"auth_database_production"}]`
 * - `BACKUPS_SCHEDULE` — `{"kind":"every","seconds":86400,"offset":7200}`, or
 *   a cron expanded: `{"kind":"cron","minutes":[0],"hours":[0,6,12,18],…}`
 * - `BACKUPS_MAX_GAP_SECONDS` — the longest the schedule goes between runs
 * - `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` — read by `pg_dump` itself
 * - `OTEL_EXPORTER_OTLP_ENDPOINT`/`_HEADERS` — where each run's result is
 *   also sent as an OTLP log, when the stage's telemetry is on
 * - `PITR_BASE_SCHEDULE` — `{"kind":"every","seconds":86400,"offset":7200}`:
 *   when a base backup is taken; unset, there is no point-in-time recovery
 * - `PITR_BASE_MAX_GAP_SECONDS` — the base schedule's interval
 * - `WALG_*`, `AWS_*` — WAL-G's archive, its key, and the key it is put with
 * - `PGDATA` — the cluster's data directory, from the Postgres image
 * - `RECOVER_TARGET`, `RECOVER_SUPERUSER`, `RECOVER_INTO`,
 *   `RECOVER_DATABASES` — what `recover` restores, and where
 */

import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createGzip } from 'node:zlib';

/** Where the runner keeps what its health check reads. */
const STATE_DIR = process.env.BACKUPS_STATE_DIR ?? '/tmp/gkm-backups';
/** How long a container may go without a good run before it has had one. */
const STARTUP_GRACE_SECONDS = 15 * 60;
/** S3's smallest part, but the last; and the size each part is cut at. */
const PART_BYTES = Number(process.env.BACKUPS_PART_BYTES) || 16 * 1024 * 1024;

export interface IntervalSchedule {
	kind: 'every';
	seconds: number;
	offset: number;
}

export interface CronSchedule {
	kind: 'cron';
	minutes: number[];
	hours: number[];
	days: number[] | null;
	months: number[] | null;
	weekdays: number[] | null;
}

export type Schedule = IntervalSchedule | CronSchedule;

/** Four years: how far ahead a cron schedule is looked for its next run. */
const CRON_HORIZON_DAYS = 4 * 366;

function cronDay(schedule: CronSchedule, date: Date): boolean {
	if (schedule.months && !schedule.months.includes(date.getUTCMonth() + 1)) {
		return false;
	}
	const dom = schedule.days?.includes(date.getUTCDate());
	const dow = schedule.weekdays?.includes(date.getUTCDay());
	if (schedule.days && schedule.weekdays) return Boolean(dom || dow);
	if (schedule.days) return Boolean(dom);
	if (schedule.weekdays) return Boolean(dow);
	return true;
}

/**
 * The first time after `after`, to the minute, the schedule runs — the copy
 * of `schedule.ts`'s `nextRun` this file carries, since it ships alone.
 */
export function nextRun(schedule: Schedule, after: Date): Date | null {
	const from = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
	if (schedule.kind === 'every') {
		const interval = schedule.seconds * 1000;
		const offset = schedule.offset * 1000;
		return new Date(offset + Math.ceil((from - offset) / interval) * interval);
	}
	const start = new Date(from);
	const day = Date.UTC(
		start.getUTCFullYear(),
		start.getUTCMonth(),
		start.getUTCDate(),
	);
	for (let i = 0; i < CRON_HORIZON_DAYS; i++) {
		const date = new Date(day + i * 86_400_000);
		if (!cronDay(schedule, date)) continue;
		for (const hour of schedule.hours) {
			for (const minute of schedule.minutes) {
				const at = date.getTime() + hour * 3_600_000 + minute * 60_000;
				if (at >= from) return new Date(at);
			}
		}
	}
	return null;
}

/** One run's folder: `2026-10-10/02-00-00Z`. */
export function runFolder(at: Date): string {
	const iso = at.toISOString();
	return `${iso.slice(0, 10)}/${iso.slice(11, 19).replace(/:/g, '-')}Z`;
}

// ============================================================================
// S3, signed here
// ============================================================================

/** Where and as whom the backups are put. */
export interface Destination {
	bucket: string;
	region: string;
	endpoint?: string;
	forcePathStyle: boolean;
	accessKeyId: string;
	secretAccessKey: string;
}

/** `BACKUPS_URL`, read the way `@geekmidas/storage/s3-url` writes it. */
export function destination(url: string): Destination {
	const parsed = new URL(url);
	if (parsed.protocol !== 's3:' || !parsed.hostname) {
		throw new BackupsEnvInvalid(
			'BACKUPS_URL',
			'is not an s3:// URL with a bucket',
		);
	}
	const endpoint = parsed.searchParams.get('endpoint') ?? undefined;
	return {
		bucket: parsed.hostname,
		region: parsed.searchParams.get('region') ?? 'us-east-1',
		...(endpoint ? { endpoint } : {}),
		forcePathStyle: parsed.searchParams.get('forcePathStyle') === 'true',
		accessKeyId: decodeURIComponent(parsed.username),
		secretAccessKey: decodeURIComponent(parsed.password),
	};
}

const sha256 = (data: string | Buffer) =>
	createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
	createHmac('sha256', key).update(data).digest();

/** RFC 3986, as SigV4 wants it: everything but unreserved characters. */
function encode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

interface S3Request {
	method: 'PUT' | 'POST';
	key: string;
	query?: Record<string, string>;
	body?: Buffer;
	headers?: Record<string, string>;
}

/** One request to S3, signed with SigV4; the response's status and body. */
export async function s3Send(
	to: Destination,
	request: S3Request,
	now: Date = new Date(),
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
	const body = request.body ?? Buffer.alloc(0);
	const path = request.key.split('/').map(encode).join('/');
	let url: URL;
	if (to.endpoint) {
		const base = to.endpoint.replace(/\/+$/, '');
		url = to.forcePathStyle
			? new URL(`${base}/${to.bucket}/${path}`)
			: new URL(`${base.replace('://', `://${to.bucket}.`)}/${path}`);
	} else {
		url = new URL(`https://${to.bucket}.s3.${to.region}.amazonaws.com/${path}`);
	}
	const query = Object.entries(request.query ?? {})
		.map(([k, v]) => [encode(k), encode(v)] as const)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${k}=${v}`)
		.join('&');

	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
	const day = amzDate.slice(0, 8);
	const payload = sha256(body);
	const headers: Record<string, string> = {
		host: url.host,
		'x-amz-content-sha256': payload,
		'x-amz-date': amzDate,
		...Object.fromEntries(
			Object.entries(request.headers ?? {}).map(([k, v]) => [
				k.toLowerCase(),
				v,
			]),
		),
	};
	const names = Object.keys(headers).sort();
	const canonical = [
		request.method,
		url.pathname,
		query,
		names.map((n) => `${n}:${headers[n]!.trim()}\n`).join(''),
		names.join(';'),
		payload,
	].join('\n');
	const scope = `${day}/${to.region}/s3/aws4_request`;
	const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join(
		'\n',
	);
	const key = hmac(
		hmac(hmac(hmac(`AWS4${to.secretAccessKey}`, day), to.region), 's3'),
		'aws4_request',
	);
	const signature = createHmac('sha256', key).update(toSign).digest('hex');
	headers.authorization =
		`AWS4-HMAC-SHA256 Credential=${to.accessKeyId}/${scope}, ` +
		`SignedHeaders=${names.join(';')}, Signature=${signature}`;
	headers['content-length'] = String(body.length);

	// Looked up when called, not bound at import: a test's HTTP interceptor
	// patches the module's own `request`.
	const send = url.protocol === 'https:' ? https.request : http.request;
	return new Promise((resolve, reject) => {
		const req = send(
			url,
			{
				method: request.method,
				headers,
				path: `${url.pathname}${query ? `?${query}` : ''}`,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString('utf-8'),
						headers: Object.fromEntries(
							Object.entries(res.headers).map(([k, v]) => [k, String(v ?? '')]),
						),
					}),
				);
				res.on('error', reject);
			},
		);
		req.on('error', reject);
		req.setTimeout(5 * 60_000, () =>
			req.destroy(new RequestTimedOut(request.key)),
		);
		req.end(body);
	});
}

/** S3 did not answer a request within five minutes. */
class RequestTimedOut extends Error {
	constructor(readonly key: string) {
		super(`S3 did not answer within five minutes putting ${key}.`);
		this.name = 'RequestTimedOut';
	}
}

/** A variable the container is started with that is missing or wrong. */
class BackupsEnvInvalid extends Error {
	constructor(
		readonly variable: string,
		readonly reason: string,
	) {
		super(
			`${variable} ${reason}. It is written by gkm into the stack's backups.env; deploy the stage again.`,
		);
		this.name = 'BackupsEnvInvalid';
	}
}

/** `pg_dump` exited with an error: the dump is not uploaded. */
class DumpFailed extends Error {
	constructor(
		readonly database: string,
		readonly code: number | null,
		readonly stderr: string,
	) {
		super(`pg_dump ${database} exited ${code}: ${stderr.trim().slice(-500)}`);
		this.name = 'DumpFailed';
	}
}

/** A request S3 refused, or that never got an answer. */
class UploadFailed extends Error {
	constructor(
		readonly key: string,
		readonly status: number,
		readonly said: string,
	) {
		super(
			`S3 answered HTTP ${status} putting ${key}: ${said.replace(/\s+/g, ' ').slice(0, 500)}`,
		);
		this.name = 'UploadFailed';
	}
}

/** `s3Send`, again after 1, 4 and 9 seconds when the network or S3 fails. */
async function sendWithRetry(
	to: Destination,
	request: S3Request,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
	let last: unknown;
	for (let attempt = 0; attempt < 4; attempt++) {
		if (attempt > 0) {
			await new Promise((r) => setTimeout(r, attempt * attempt * 1000));
		}
		try {
			const res = await s3Send(to, request);
			if (res.status >= 200 && res.status < 300) return res;
			last = new UploadFailed(request.key, res.status, res.body);
			// A refusal is the key's or the request's; asking again changes nothing.
			if (res.status < 500) break;
		} catch (error) {
			last = error;
		}
	}
	throw last;
}

/**
 * Upload a stream to `key`: one PUT when it fits in a part, else a multipart
 * upload — every action of which is `s3:PutObject`, all the key may do. A
 * failed upload is left for the bucket's lifecycle to abort.
 */
export async function upload(
	to: Destination,
	key: string,
	stream: AsyncIterable<Buffer>,
	/**
	 * How what made the stream ended. Awaited before the last request: a dump
	 * that failed half way ends its stream early, and must never be put as
	 * though it were whole.
	 */
	finished: Promise<void> = Promise.resolve(),
): Promise<number> {
	let buffered: Buffer[] = [];
	let size = 0;
	let total = 0;
	let uploadId: string | undefined;
	const parts: string[] = [];

	const flush = async (body: Buffer) => {
		if (!uploadId) {
			const created = await sendWithRetry(to, {
				method: 'POST',
				key,
				query: { uploads: '' },
				headers: { 'content-type': 'application/gzip' },
			});
			uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(created.body)?.[1];
			if (!uploadId) throw new UploadFailed(key, created.status, created.body);
		}
		const part = await sendWithRetry(to, {
			method: 'PUT',
			key,
			query: { partNumber: String(parts.length + 1), uploadId },
			body,
		});
		parts.push(part.headers.etag ?? '');
	};

	for await (const chunk of stream) {
		buffered.push(chunk);
		size += chunk.length;
		total += chunk.length;
		if (size >= PART_BYTES) {
			const body = Buffer.concat(buffered);
			buffered = [];
			size = 0;
			await flush(body);
		}
	}
	await finished;
	const rest = Buffer.concat(buffered);
	if (!uploadId) {
		await sendWithRetry(to, {
			method: 'PUT',
			key,
			body: rest,
			headers: { 'content-type': 'application/gzip' },
		});
		return total;
	}
	if (rest.length > 0) await flush(rest);
	const complete = parts
		.map(
			(etag, i) =>
				`<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`,
		)
		.join('');
	const done = await sendWithRetry(to, {
		method: 'POST',
		key,
		query: { uploadId: uploadId! },
		body: Buffer.from(
			`<CompleteMultipartUpload>${complete}</CompleteMultipartUpload>`,
		),
		headers: { 'content-type': 'application/xml' },
	});
	// S3 can answer 200 and put an error in the body.
	if (/<Error>/.test(done.body)) throw new UploadFailed(key, 200, done.body);
	return total;
}

// ============================================================================
// A run
// ============================================================================

export interface BackupDatabase {
	file: string;
	name: string;
}

/** Who else is told each line — a test, reading what a run said. */
const listeners = new Set<(line: Record<string, unknown>) => void>();

/** Be handed each line the runner logs. Returns what stops it. */
export function onReport(
	listener: (line: Record<string, unknown>) => void,
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** One line of the run's result: JSON on stdout, and OTLP when telemetry is on. */
async function report(
	level: 'info' | 'error',
	message: string,
	fields: Record<string, unknown>,
): Promise<void> {
	const at = new Date();
	const line = { time: at.toISOString(), level, msg: message, ...fields };
	const out = level === 'error' ? process.stderr : process.stdout;
	out.write(`${JSON.stringify(line)}\n`);
	for (const listener of listeners) listener(line);
	// A run `docker exec` started (`gkm backup:now`) is in the container's
	// log too, beside the scheduled ones: written to the main process's own.
	if (process.pid !== 1 && process.platform === 'linux') {
		try {
			appendFileSync(
				`/proc/1/fd/${level === 'error' ? 2 : 1}`,
				`${JSON.stringify(line)}\n`,
			);
		} catch {
			// Not in the container, or not allowed: the caller has the line.
		}
	}

	const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
	if (!endpoint) return;
	const headers: Record<string, string> = {
		'content-type': 'application/json',
	};
	for (const pair of (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '').split(
		',',
	)) {
		const at = pair.indexOf('=');
		if (at > 0) {
			headers[decodeURIComponent(pair.slice(0, at).trim())] =
				decodeURIComponent(pair.slice(at + 1).trim());
		}
	}
	const value = (v: unknown) =>
		typeof v === 'number'
			? { doubleValue: v }
			: typeof v === 'boolean'
				? { boolValue: v }
				: { stringValue: typeof v === 'string' ? v : JSON.stringify(v) };
	const body = JSON.stringify({
		resourceLogs: [
			{
				resource: {
					attributes: [
						{
							key: 'service.name',
							value: {
								stringValue: process.env.OTEL_SERVICE_NAME ?? 'backups',
							},
						},
					],
				},
				scopeLogs: [
					{
						scope: { name: 'gkm-backups' },
						logRecords: [
							{
								timeUnixNano: `${at.getTime()}000000`,
								severityText: level.toUpperCase(),
								severityNumber: level === 'error' ? 17 : 9,
								body: { stringValue: message },
								attributes: Object.entries(fields).map(([key, v]) => ({
									key,
									value: value(v),
								})),
							},
						],
					},
				],
			},
		],
	});
	try {
		await fetch(`${endpoint.replace(/\/+$/, '')}/v1/logs`, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		// Telemetry that cannot be delivered never fails a backup.
	}
}

/** `pg_dump` of one database, gzipped, as a stream — and how it ended. */
function dump(database: string): {
	stream: AsyncIterable<Buffer>;
	done: Promise<void>;
} {
	const child = spawn(
		'pg_dump',
		[
			'--format=plain',
			// A restore recreates the database as it was, owners and grants
			// included, over whatever is there.
			'--create',
			'--clean',
			'--if-exists',
			'--dbname',
			database,
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	);
	let stderr = '';
	child.stderr.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const gzip = createGzip();
	child.stdout.pipe(gzip);
	const done = new Promise<void>((resolve, reject) => {
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve() : reject(new DumpFailed(database, code, stderr)),
		);
	});
	return { stream: gzip, done };
}

function readEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new BackupsEnvInvalid(name, 'is not set');
	return value;
}

/** A lock, so `backup:now` and the schedule never dump at once. */
async function withLock<T>(run: () => Promise<T>): Promise<T> {
	mkdirSync(STATE_DIR, { recursive: true });
	const lock = `${STATE_DIR}/lock`;
	for (;;) {
		try {
			mkdirSync(lock);
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
	try {
		return await run();
	} finally {
		rmdirSync(lock);
	}
}

/** One backup of every database, into one run folder. Resolves whether it all went. */
export async function backupOnce(at: Date = new Date()): Promise<boolean> {
	return withLock(async () => {
		const to = destination(readEnv('BACKUPS_URL'));
		const prefix = readEnv('BACKUPS_PREFIX').replace(/\/+$/, '');
		const databases = JSON.parse(
			readEnv('BACKUPS_DATABASES'),
		) as BackupDatabase[];
		// A run's folder is its second: one that would share the last run's
		// — `backup:now` twice in a second — waits for the next, and is never
		// written over the other.
		let startedAt = at;
		const last = (() => {
			try {
				return readFileSync(`${STATE_DIR}/last-folder`, 'utf-8');
			} catch {
				return undefined;
			}
		})();
		while (runFolder(startedAt) === last) {
			await new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 5));
			startedAt = new Date();
		}
		writeFileSync(`${STATE_DIR}/last-folder`, runFolder(startedAt));
		const folder = `${prefix}/${runFolder(startedAt)}`;
		const started = Date.now();
		const sizes: Record<string, number> = {};
		const failed: Record<string, string> = {};

		for (const database of databases) {
			const key = `${folder}/${database.file}.sql.gz`;
			try {
				const { stream, done } = dump(database.name);
				// Handled by the upload, which waits for it before its last
				// request; never left to reject on its own.
				done.catch(() => {});
				sizes[database.file] = await upload(to, key, stream, done);
			} catch (error) {
				failed[database.file] =
					error instanceof Error ? error.message : String(error);
			}
		}

		const ok = Object.keys(failed).length === 0;
		const fields = {
			folder,
			databases: databases.map((d) => d.file),
			bytes: sizes,
			durationMs: Date.now() - started,
			...(ok ? {} : { failed }),
		};
		if (ok) {
			writeFileSync(`${STATE_DIR}/last-success`, String(Date.now()));
			await report('info', 'backup finished', { ok, ...fields });
		} else {
			await report('error', 'backup failed', { ok, ...fields });
		}
		return ok;
	});
}

// ============================================================================
// Point-in-time recovery
// ============================================================================

/** WAL-G, `psql` or `pg_dump` exited with an error. */
class CommandFailed extends Error {
	constructor(
		readonly command: string,
		readonly code: number | null,
		readonly stderr: string,
	) {
		super(`${command} exited ${code}: ${stderr.trim().slice(-500)}`);
		this.name = 'CommandFailed';
	}
}

/** No base backup finished at or before the time a restore asked for. */
class NoBaseBackupBefore extends Error {
	constructor(
		readonly target: string,
		readonly earliest: string | null,
	) {
		super(
			`No base backup finished at or before ${target}` +
				(earliest
					? `; the earliest finished at ${earliest}. Restore to a time after it.`
					: '; there is none yet. Take one: gkm backup:now --base.'),
		);
		this.name = 'NoBaseBackupBefore';
	}
}

/** Postgres stopped before it reached the time a restore asked for. */
class RecoveryFailed extends Error {
	constructor(
		readonly target: string,
		readonly code: number | null,
		readonly log: string,
	) {
		super(
			`Postgres stopped (exit ${code}) before it recovered to ${target}: ` +
				`${log.trim().slice(-800)}`,
		);
		this.name = 'RecoveryFailed';
	}
}

/** `swap` found no recovered cluster to put in place. */
class NothingRecovered extends Error {
	constructor(readonly dir: string) {
		super(
			`There is no recovered cluster at ${dir}, so the live one was left in place. Run the restore again.`,
		);
		this.name = 'NothingRecovered';
	}
}

/** Whether this container takes base backups: point-in-time recovery is on. */
function pitrOn(): boolean {
	return Boolean(process.env.PITR_BASE_SCHEDULE);
}

/** Run a program to its end; its exit code and what it printed. */
function capture(
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ code, stdout, stderr }));
	});
}

/** The cluster's data directory, as the Postgres image names it. */
function dataDirectory(): string {
	return readEnv('PGDATA').replace(/\/+$/, '');
}

/** WAL-G connects to the cluster's own database, never one named after the role. */
function walgEnv(): NodeJS.ProcessEnv {
	return { ...process.env, PGDATABASE: process.env.PGDATABASE || 'postgres' };
}

/**
 * One base backup now — `wal-g backup-push` of the data directory, mounted
 * read-only — encrypted and put under the PITR prefix. Resolves whether it
 * went.
 */
export async function baseBackupOnce(): Promise<boolean> {
	return withLock(async () => {
		const started = Date.now();
		const result = await capture(
			'wal-g',
			['backup-push', dataDirectory()],
			walgEnv(),
		).catch(
			(error: unknown) =>
				({
					code: null,
					stdout: '',
					stderr: error instanceof Error ? error.message : String(error),
				}) as const,
		);
		const fields = {
			prefix: process.env.WALG_S3_PREFIX ?? null,
			durationMs: Date.now() - started,
		};
		if (result.code === 0) {
			writeFileSync(`${STATE_DIR}/last-base`, String(Date.now()));
			await report('info', 'base backup finished', { ok: true, ...fields });
			return true;
		}
		await report('error', 'base backup failed', {
			ok: false,
			...fields,
			error: new CommandFailed('wal-g backup-push', result.code, result.stderr)
				.message,
		});
		return false;
	});
}

/** How long a WAL segment may wait to be archived before the container is unhealthy. */
export const ARCHIVE_LAG_SECONDS = 5 * 60;

/** What `pg_stat_archiver` — and the segments still waiting — say. */
export interface ArchiverState {
	/** Seconds since a segment was last archived, or `null` for never. */
	sinceArchived: number | null;
	failedCount: number;
	/** Whether the last attempt failed: `last_failed_time` after `last_archived_time`. */
	failing: boolean;
	/** Seconds the oldest segment has waited to be archived, or `null` for none. */
	oldestWaiting: number | null;
}

/**
 * Whether archiving is keeping up — and, when it is not, why. A segment
 * waiting more than five minutes means `archive_command` is stuck or slow
 * (with `archive_timeout=60`, one should ship within the minute); the last
 * attempt failing means it is failing now. A quiet cluster writes no WAL, so
 * an old `last_archived_time` alone is not a fault.
 */
export function archiverVerdict(state: ArchiverState): string | undefined {
	if (state.failing) {
		return `archive_command is failing (${state.failedCount} failures; the last attempt failed)`;
	}
	if (
		state.oldestWaiting !== null &&
		state.oldestWaiting > ARCHIVE_LAG_SECONDS
	) {
		return (
			`a WAL segment has waited ${state.oldestWaiting}s to be archived` +
			(state.sinceArchived === null
				? ', and none ever was'
				: `; the last was archived ${state.sinceArchived}s ago`)
		);
	}
	return undefined;
}

/** `pg_stat_archiver`, and how long the oldest segment has waited. */
const ARCHIVER_SQL = `SELECT
  coalesce(floor(extract(epoch FROM now() - last_archived_time))::text, ''),
  failed_count,
  (last_failed_time IS NOT NULL AND (last_archived_time IS NULL OR last_failed_time > last_archived_time)),
  coalesce((SELECT floor(extract(epoch FROM now() - min(modification)))::text
    FROM pg_ls_archive_statusdir() WHERE name LIKE '%.ready'), '')
FROM pg_stat_archiver`;

/** Read the archiver's state from the stack's Postgres. */
export async function readArchiver(): Promise<ArchiverState> {
	const result = await capture(
		'psql',
		['-X', '-A', '-t', '-q', '-F', '|', '-d', 'postgres', '-c', ARCHIVER_SQL],
		process.env,
	);
	if (result.code !== 0) {
		throw new CommandFailed('psql', result.code, result.stderr);
	}
	const [since = '', failed = '0', failing = 'f', waiting = ''] = result.stdout
		.trim()
		.split('|');
	return {
		sinceArchived: since === '' ? null : Number(since),
		failedCount: Number(failed),
		failing: failing === 't',
		oldestWaiting: waiting === '' ? null : Number(waiting),
	};
}

/** Whether the last good run — or, before one, the start — is recent enough. */
export function healthy(now = Date.now()): boolean {
	const gap = Number(readEnv('BACKUPS_MAX_GAP_SECONDS'));
	const read = (file: string) => {
		try {
			return Number(readFileSync(`${STATE_DIR}/${file}`, 'utf-8'));
		} catch {
			return undefined;
		}
	};
	const recent = (file: string, gapSeconds: number) => {
		const since = read(file) ?? read('started');
		if (since === undefined) return false;
		return now - since <= (2 * gapSeconds + STARTUP_GRACE_SECONDS) * 1000;
	};
	if (!recent('last-success', gap)) return false;
	// The last base backup, too, is no older than twice its interval.
	if (pitrOn()) {
		return recent('last-base', Number(readEnv('PITR_BASE_MAX_GAP_SECONDS')));
	}
	return true;
}

/** The health check: the runs' ages, and — with PITR — the archiver. */
async function health(): Promise<boolean> {
	if (!healthy()) return false;
	if (!pitrOn()) return true;
	let problem: string | undefined;
	try {
		problem = archiverVerdict(await readArchiver());
	} catch (error) {
		problem = error instanceof Error ? error.message : String(error);
	}
	if (problem) {
		process.stderr.write(`${problem}\n`);
		return false;
	}
	return true;
}

/** One job `serve` runs: the dumps, or the base backups. */
interface Job {
	schedule: Schedule;
	run: (at: Date) => Promise<unknown>;
	failed: string;
	next: Date | null;
}

/** Run on schedule, forever. */
export async function serve(): Promise<void> {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(`${STATE_DIR}/started`, String(Date.now()));
	const now = new Date();
	const jobs: Job[] = [
		{
			schedule: JSON.parse(readEnv('BACKUPS_SCHEDULE')) as Schedule,
			run: (at) => backupOnce(at),
			failed: 'backup failed',
			next: null,
		},
		...(pitrOn()
			? [
					{
						schedule: JSON.parse(readEnv('PITR_BASE_SCHEDULE')) as Schedule,
						run: () => baseBackupOnce(),
						failed: 'base backup failed',
						next: null,
					},
				]
			: []),
	];
	for (const job of jobs) job.next = nextRun(job.schedule, now);
	let stopping = false;
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.once(signal, () => {
			stopping = true;
			process.exit(0);
		});
	}
	await report('info', 'backups scheduled', {
		next: jobs[0]!.next?.toISOString() ?? null,
		...(jobs[1] ? { nextBase: jobs[1].next?.toISOString() ?? null } : {}),
	});
	while (!stopping) {
		const due: Job | undefined = jobs
			.filter((job) => job.next !== null)
			.sort((a, b) => a.next!.getTime() - b.next!.getTime())[0];
		const at = due?.next;
		if (!due || !at) return;
		// Woken at least hourly, so a clock that jumps never oversleeps a run.
		while (Date.now() < at.getTime()) {
			await new Promise((r) =>
				setTimeout(r, Math.min(at.getTime() - Date.now(), 3_600_000)),
			);
		}
		await due.run(at).catch((error: unknown) =>
			report('error', due.failed, {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		due.next = nextRun(due.schedule, new Date());
	}
}

/** A base backup, as `wal-g backup-list --json --detail` lists it. */
export interface BaseBackup {
	backup_name: string;
	finish_time: string;
	start_time?: string;
}

/**
 * The base backup a restore to `target` replays from: the newest that had
 * finished by then — a cluster is consistent only from its backup's end.
 */
export function chooseBase(
	backups: readonly BaseBackup[],
	target: Date,
): BaseBackup {
	const finished = [...backups].sort(
		(a, b) => Date.parse(a.finish_time) - Date.parse(b.finish_time),
	);
	const chosen = finished
		.filter((b) => Date.parse(b.finish_time) <= target.getTime())
		.at(-1);
	if (!chosen) {
		throw new NoBaseBackupBefore(
			target.toISOString(),
			finished[0]?.finish_time ?? null,
		);
	}
	return chosen;
}

/** Where `recover` puts the cluster it brings back. */
export function recoveryDirectory(into: string | undefined): string {
	// Beside the live cluster, in its volume: a swap is a rename. Inspected
	// into a database instead, it is thrown away after, so it stays in the
	// container.
	return into ? '/tmp/gkm-recover/data' : `${dataDirectory()}.gkm-restore`;
}

/** `2026-11-16T10:00:00.000Z` as Postgres reads a `recovery_target_time`. */
export function recoveryTargetTime(target: Date): string {
	return target.toISOString().replace('T', ' ').replace(/Z$/, '+00');
}

/** A database's copy, for `--into <name>`: `drill_auth_database`. */
export function intoDatabase(into: string, file: string): string {
	return `${into}_${file.replace(/-/g, '_')}`;
}

/** psql against the recovering cluster, over its socket in the container. */
function localPsql(sql: string, database = 'postgres') {
	return capture(
		'psql',
		['-X', '-A', '-t', '-q', '-h', '/tmp', '-d', database, '-c', sql],
		{ ...process.env, PGUSER: readEnv('RECOVER_SUPERUSER') },
	);
}

/** Pipe `pg_dump` of the recovered database into a new one on the live cluster. */
function copyInto(name: string, target: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const local = { ...process.env, PGUSER: readEnv('RECOVER_SUPERUSER') };
		const dumpProcess = spawn(
			'pg_dump',
			['-h', '/tmp', '--format=plain', '--dbname', name],
			{ env: local, stdio: ['ignore', 'pipe', 'pipe'] },
		);
		const load = spawn(
			'psql',
			['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', target, '-o', '/dev/null'],
			{ env: process.env, stdio: ['pipe', 'ignore', 'pipe'] },
		);
		let dumpErr = '';
		let loadErr = '';
		dumpProcess.stderr.on('data', (c: Buffer) => {
			dumpErr += c.toString();
		});
		load.stderr.on('data', (c: Buffer) => {
			loadErr += c.toString();
		});
		dumpProcess.stdout.pipe(load.stdin);
		let dumped: number | null | undefined;
		let loaded: number | null | undefined;
		const settle = () => {
			if (dumped === undefined || loaded === undefined) return;
			if (dumped !== 0) reject(new CommandFailed('pg_dump', dumped, dumpErr));
			else if (loaded !== 0) reject(new CommandFailed('psql', loaded, loadErr));
			else resolve();
		};
		dumpProcess.on('error', reject);
		load.on('error', reject);
		dumpProcess.on('close', (code) => {
			dumped = code;
			settle();
		});
		load.on('close', (code) => {
			loaded = code;
			settle();
		});
	});
}

/**
 * Bring the cluster back to `RECOVER_TARGET`: the newest base backup that
 * had finished by then, fetched, and Postgres started on it to replay WAL
 * from the archive up to that second, then promoted.
 *
 * - Without `RECOVER_INTO`, the recovered cluster is left stopped beside
 *   the live one, for `swap`. It archives what it writes once promoted —
 *   its new timeline's history — so a later restore can follow it.
 * - With it, each database is copied into `<into>_<database>` on the live
 *   cluster, and the recovered one thrown away. It archives nothing: a
 *   drill's timeline must never be one a later restore follows.
 */
export async function recover(): Promise<boolean> {
	const target = new Date(readEnv('RECOVER_TARGET'));
	const into = process.env.RECOVER_INTO || undefined;
	const dir = recoveryDirectory(into);

	const listed = await capture(
		'wal-g',
		['backup-list', '--json', '--detail'],
		walgEnv(),
	);
	if (listed.code !== 0) {
		throw new CommandFailed('wal-g backup-list', listed.code, listed.stderr);
	}
	const base = chooseBase(
		JSON.parse(listed.stdout || '[]') as BaseBackup[],
		target,
	);
	await report('info', 'fetching base backup', {
		backup: base.backup_name,
		finished: base.finish_time,
		target: target.toISOString(),
	});

	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const fetched = await capture(
		'wal-g',
		['backup-fetch', dir, base.backup_name],
		walgEnv(),
	);
	if (fetched.code !== 0) {
		throw new CommandFailed('wal-g backup-fetch', fetched.code, fetched.stderr);
	}
	writeFileSync(`${dir}/recovery.signal`, '');

	const settings: Record<string, string> = {
		listen_addresses: '',
		unix_socket_directories: '/tmp',
		restore_command: 'wal-g wal-fetch %f %p',
		recovery_target_time: recoveryTargetTime(target),
		recovery_target_action: 'promote',
		archive_mode: into ? 'off' : 'on',
		archive_command: 'wal-g wal-push %p',
	};
	const server = spawn(
		'postgres',
		[
			'-D',
			dir,
			...Object.entries(settings).flatMap(([k, v]) => ['-c', `${k}=${v}`]),
		],
		{ env: walgEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
	);
	let log = '';
	server.stdout.on('data', (c: Buffer) => {
		log = (log + c.toString()).slice(-20_000);
	});
	server.stderr.on('data', (c: Buffer) => {
		log = (log + c.toString()).slice(-20_000);
	});
	let exited: number | null | undefined;
	const stopped = new Promise<void>((resolve) => {
		server.on('close', (code) => {
			exited = code;
			resolve();
		});
	});

	try {
		// Replaying: connections open once the cluster is consistent, and it
		// leaves recovery when it reaches the target and promotes.
		for (;;) {
			if (exited !== undefined) {
				throw new RecoveryFailed(target.toISOString(), exited, log);
			}
			const answer = await localPsql('SELECT pg_is_in_recovery()');
			if (answer.code === 0 && answer.stdout.trim() === 'f') break;
			await new Promise((r) => setTimeout(r, 2000));
		}
		await report('info', 'recovered', { target: target.toISOString() });

		if (into) {
			const databases = JSON.parse(
				readEnv('RECOVER_DATABASES'),
			) as BackupDatabase[];
			for (const database of databases) {
				const name = intoDatabase(into, database.file);
				const quoted = `"${name.replace(/"/g, '""')}"`;
				for (const sql of [
					`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`,
					`CREATE DATABASE ${quoted}`,
				]) {
					const done = await capture(
						'psql',
						['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', sql],
						process.env,
					);
					if (done.code !== 0) {
						throw new CommandFailed('psql', done.code, done.stderr);
					}
				}
				await copyInto(database.name, name);
				await report('info', 'copied', { from: database.name, into: name });
			}
		}
	} finally {
		// A fast shutdown: clean, and the archiver's last round first.
		if (exited === undefined) server.kill('SIGINT');
		await stopped;
		if (into) rmSync(dir, { recursive: true, force: true });
	}
	return true;
}

/**
 * Put the recovered cluster in place of the live one, Postgres stopped: the
 * live data directory kept beside it as `<PGDATA>.gkm-previous` until the
 * next swap, the recovered one renamed into its place. Both are in the same
 * volume, so neither is copied.
 */
export function swap(): void {
	const data = dataDirectory();
	const restored = `${data}.gkm-restore`;
	const previous = `${data}.gkm-previous`;
	if (!existsSync(`${restored}/PG_VERSION`)) {
		throw new NothingRecovered(restored);
	}
	rmSync(previous, { recursive: true, force: true });
	if (existsSync(data)) renameSync(data, previous);
	renameSync(restored, data);
}

/** The commands the program takes. */
const USAGE = 'usage: backup.mjs serve | run | health | base | recover | swap';

/** What `node backup.mjs <command>` runs; resolves with its exit code. */
export async function main(command: string | undefined): Promise<number> {
	if (command === 'serve') {
		await serve();
		return 0;
	}
	if (command === 'run') return (await backupOnce()) ? 0 : 1;
	if (command === 'health') return (await health()) ? 0 : 1;
	if (command === 'base') return (await baseBackupOnce()) ? 0 : 1;
	if (command === 'recover') return (await recover()) ? 0 : 1;
	if (command === 'swap') {
		swap();
		await report('info', 'swapped', { data: dataDirectory() });
		return 0;
	}
	await report('error', USAGE, { command: command ?? null });
	return 2;
}

// Run as a program, not when imported by a test.
if (
	process.argv[1] &&
	/backup\.mjs$|runner\.(?:ts|mjs)$/.test(process.argv[1])
) {
	main(process.argv[2]).then(
		(code) => process.exit(code),
		async (error: unknown) => {
			await report('error', 'backup failed', {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		},
	);
}
