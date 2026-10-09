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
 * Its key may only put objects under the prefix: it never reads, lists or
 * deletes, so nothing here does either. A dump is uploaded in parts as it is
 * made, so no database is ever held on disk or in memory whole.
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
 */

import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	rmdirSync,
	writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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

	const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
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
	const since = read('last-success') ?? read('started');
	if (since === undefined) return false;
	return now - since <= (2 * gap + STARTUP_GRACE_SECONDS) * 1000;
}

/** Run on schedule, forever. */
async function serve(): Promise<void> {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(`${STATE_DIR}/started`, String(Date.now()));
	const schedule = JSON.parse(readEnv('BACKUPS_SCHEDULE')) as Schedule;
	let stopping = false;
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.on(signal, () => {
			stopping = true;
			process.exit(0);
		});
	}
	await report('info', 'backups scheduled', {
		next: nextRun(schedule, new Date())?.toISOString() ?? null,
	});
	while (!stopping) {
		const next = nextRun(schedule, new Date());
		if (!next) return;
		// Woken at least hourly, so a clock that jumps never oversleeps a run.
		while (Date.now() < next.getTime()) {
			await new Promise((r) =>
				setTimeout(r, Math.min(next.getTime() - Date.now(), 3_600_000)),
			);
		}
		await backupOnce(next).catch((error: unknown) =>
			report('error', 'backup failed', {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}

async function main(command: string | undefined): Promise<number> {
	if (command === 'serve') {
		await serve();
		return 0;
	}
	if (command === 'run') return (await backupOnce()) ? 0 : 1;
	if (command === 'health') return healthy() ? 0 : 1;
	process.stderr.write('usage: backup.mjs serve | run | health\n');
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
