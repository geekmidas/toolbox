/**
 * `gkm backup:list`, `gkm backup:now` and `gkm backup:restore` — run from a
 * laptop or CI with the stage account's own credentials.
 *
 * - **list** reads the stage's backups prefix with the caller's credentials.
 *   The stage's backups key cannot: it may only put.
 * - **now** asks the stack's backups container to run, through `docker exec`
 *   on whatever Docker the stage runs on.
 * - **restore** asks first (`--yes` skips it), takes a fresh backup, then
 *   streams each database's file from S3 — with the caller's credentials —
 *   into a one-off container of the backups image on the stack's network,
 *   which recreates the database from it as the stack's superuser.
 * - **restore --from** loads a prepared, data-only file kept under the
 *   stage's `imports/` instead: the stack's apps are stopped, the database's
 *   other sessions ended, and the file run inside it in one transaction —
 *   then the apps are started again, whatever happened.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { S3Client } from '@aws-sdk/client-s3';
import type { ConstructManifest } from '@geekmidas/manifest';
import {
	type ComposeDocker,
	ContainersNotStarted,
	ContainersNotStopped,
	type DockerEngine,
	dockerCompose,
	projectNetwork,
	type StackRef,
} from '../compose/docker.js';
import { composeServer, dockerHost } from '../compose/server.js';
import {
	composeProject,
	derivedCredentials,
	stackPlan,
} from '../compose/stack.js';
import { loadWorkspaceConfig } from '../config.js';
import { deployIdentity } from '../deploy/identity.js';
import { GkmError } from '../errors';
import { prompt } from '../prompt.js';
import {
	awsClientConfig,
	awsEndpoint,
	awsProvisioningCredentials,
} from '../providers/aws.js';
import { discover } from '../reconcile/discover.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { secretsStoreFor } from '../secrets/store.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import {
	type BackupDatabase,
	backupDatabases,
	backupFile,
	backupsPrefix,
	runTime,
	stageBackups,
} from './config.js';
import { BACKUPS_SERVICE, BACKUPS_URL_KEY, RUNNER_PATH } from './service.js';

/** One run's folder, and what is in it. */
export interface BackupRun {
	/** `2026-10-10/02-00-00Z`. */
	folder: string;
	at: Date;
	/** Each database's file, by its name less `.sql.gz`, and its size. */
	files: { database: string; size: number }[];
}

/** A stage that has no backups to list or restore. */
export class BackupsNotOn extends GkmError {
	constructor(
		readonly stage: string,
		readonly reason: string,
	) {
		super(`'${stage}' takes no backups: ${reason}.`);
		this.name = 'BackupsNotOn';
	}
}

/** A stage whose secrets hold no backups key yet: it was never deployed. */
export class BackupsNotProvisioned extends GkmError {
	constructor(readonly stage: string) {
		super(
			`'${stage}' has no ${BACKUPS_URL_KEY} in its secrets, so it has never been ` +
				`deployed with backups. Deploy it: gkm deploy --stage ${stage}.`,
		);
		this.name = 'BackupsNotProvisioned';
	}
}

/** The stage's prefix holds no run. */
export class NoBackups extends GkmError {
	constructor(
		readonly stage: string,
		readonly location: string,
	) {
		super(
			`'${stage}' has no backups at ${location} yet. Take one: gkm backup:now --stage ${stage}.`,
		);
		this.name = 'NoBackups';
	}
}

/** No run at or before the time asked for. */
export class BackupRunNotFound extends GkmError {
	constructor(
		readonly at: string,
		readonly runs: readonly string[],
	) {
		super(
			`No backup at or before '${at}'. The runs there are: ${runs.slice(0, 10).join(', ')}${runs.length > 10 ? ', …' : ''}. ` +
				'Pass one of them as --at, a time (2026-10-10T02:00:00Z), or --latest.',
		);
		this.name = 'BackupRunNotFound';
	}
}

/** Not exactly one of `--at`, `--latest` and `--from`. */
export class BackupRunNotChosen extends GkmError {
	constructor() {
		super(
			'Say which backup to restore, and only one: --latest; --at <time> — a run ' +
				'folder (2026-10-10/02-00-00Z) or a time, for the newest run at or ' +
				'before it; or --from imports/<file>.sql.gz, a prepared import.',
		);
		this.name = 'BackupRunNotChosen';
	}
}

/** `--database` names no database the stack runs. */
export class BackupDatabaseUnknown extends GkmError {
	constructor(
		readonly database: string,
		readonly known: readonly string[],
	) {
		super(
			`'${database}' is not one of the stack's databases: ${known.join(', ')}. ` +
				'Name one by its file — its construct in kebab case, as db/<name>.',
		);
		this.name = 'BackupDatabaseUnknown';
	}
}

/** The run's folder does not hold a database the restore needs. */
export class BackupDatabaseMissing extends GkmError {
	constructor(
		readonly folder: string,
		readonly database: string,
		readonly has: readonly string[],
	) {
		super(
			`The backup ${folder} holds no ${database} (it has ${has.join(', ') || 'nothing'}), ` +
				'so nothing was restored. Choose another run with --at, or restore the ' +
				'others with --database.',
		);
		this.name = 'BackupDatabaseMissing';
	}
}

/** The folder every import is kept in, under the stage's backups prefix. */
export const IMPORTS_FOLDER = 'imports';

/** A file prepared to be loaded with `--from`: `imports/app.sql.gz`. */
export interface BackupImport {
	/** Relative to the stage's backups prefix — what `--from` takes. */
	file: string;
	size: number;
	modified?: Date;
}

/** `--from` names something that is not a file under the stage's `imports/`. */
export class ImportPathInvalid extends GkmError {
	constructor(
		readonly from: string,
		readonly reason: string,
	) {
		super(
			`--from '${from}' ${reason}. Name a file in the ${IMPORTS_FOLDER}/ folder ` +
				`under the stage's backups prefix: --from ${IMPORTS_FOLDER}/<file>.sql.gz ` +
				'(gkm backup:list shows what is there).',
		);
		this.name = 'ImportPathInvalid';
	}
}

/** `--from` without `--database`: a file loads into one database. */
export class ImportNeedsDatabase extends GkmError {
	constructor(
		readonly from: string,
		readonly known: readonly string[],
	) {
		super(
			`--from ${from} loads into one database: name it with --database ` +
				`(${known.join(', ') || 'the stack runs none'}).`,
		);
		this.name = 'ImportNeedsDatabase';
	}
}

/** No file at the key `--from` names. */
export class ImportNotFound extends GkmError {
	constructor(
		readonly from: string,
		readonly location: string,
	) {
		super(
			`There is no ${from} at ${location}. Upload the prepared file there, ` +
				'or pick one gkm backup:list shows.',
		);
		this.name = 'ImportNotFound';
	}
}

/**
 * The stack's apps, stopped for an import, could not be started again.
 * `loaded` says whether the import itself went in.
 */
export class AppsNotRestarted extends GkmError {
	constructor(
		readonly project: string,
		readonly database: string,
		readonly loaded: boolean,
		readonly ids: readonly string[],
		readonly output: string,
	) {
		super(
			`${loaded ? `${database} was loaded` : `Loading ${database} failed and changed nothing`}, ` +
				`but ${project}'s apps, stopped for it, did not start again (docker said: ` +
				`${output.trim() || 'nothing'}). Start them on the stage's server with ` +
				`\`docker start ${ids.join(' ')}\`, or deploy the stage.`,
		);
		this.name = 'AppsNotRestarted';
	}
}

/**
 * The key `--from` names, under the stage's backups prefix — refusing
 * anything that would read outside its `imports/` folder.
 *
 * @throws {ImportPathInvalid}
 */
export function importKey(prefix: string, from: string): string {
	if (/^[a-z][a-z\d+.-]*:/i.test(from)) {
		throw new ImportPathInvalid(from, 'is a URL, not a path');
	}
	if (from.startsWith('/')) {
		throw new ImportPathInvalid(from, 'is absolute');
	}
	if (from.includes('\\')) {
		throw new ImportPathInvalid(from, 'has a backslash');
	}
	const segments = from.split('/');
	if (segments.some((s) => s === '' || s === '.' || s === '..')) {
		throw new ImportPathInvalid(from, "has an empty, '.' or '..' segment");
	}
	if (segments[0] !== IMPORTS_FOLDER || segments.length < 2) {
		throw new ImportPathInvalid(from, `is not in ${IMPORTS_FOLDER}/`);
	}
	if (!from.endsWith('.sql.gz')) {
		throw new ImportPathInvalid(from, 'is not a gzipped SQL file (.sql.gz)');
	}
	return `${prefix}/${from}`;
}

/** Every file under the stage's `imports/`, by name. */
export async function listImports(
	s3: S3Client,
	bucket: string,
	prefix: string,
): Promise<BackupImport[]> {
	const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
	const imports: BackupImport[] = [];
	let token: string | undefined;
	do {
		const page = await s3.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: `${prefix}/${IMPORTS_FOLDER}/`,
				...(token ? { ContinuationToken: token } : {}),
			}),
		);
		for (const object of page.Contents ?? []) {
			const file = object.Key?.slice(prefix.length + 1) ?? '';
			if (!file || file.endsWith('/')) continue;
			imports.push({
				file,
				size: object.Size ?? 0,
				...(object.LastModified ? { modified: object.LastModified } : {}),
			});
		}
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
	return imports.sort((a, b) => a.file.localeCompare(b.file));
}

/** The lines `backup:list` prints for the imports, by name. */
export function formatImports(imports: readonly BackupImport[]): string[] {
	return imports.map(
		(i) =>
			`${i.file}  ${formatSize(i.size)}` +
			(i.modified ? `  uploaded ${formatTime(i.modified)}` : ''),
	);
}

/** `2026-10-10 02:00:00Z`. */
function formatTime(at: Date): string {
	return at
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d{3}Z$/, 'Z');
}

/** Nobody said yes. */
export class RestoreNotConfirmed extends GkmError {
	constructor(readonly stage: string) {
		super(`Nothing was restored on '${stage}'.`);
		this.name = 'RestoreNotConfirmed';
	}
}

/** The stack's backups container is not running where Docker points. */
export class BackupsContainerNotRunning extends GkmError {
	constructor(readonly project: string) {
		super(
			`No ${BACKUPS_SERVICE} container of ${project} is running on this Docker. ` +
				"Point Docker at the stage's server, or deploy the stage.",
		);
		this.name = 'BackupsContainerNotRunning';
	}
}

/** A backup the container was asked for failed. */
export class BackupRunFailed extends GkmError {
	constructor(
		readonly project: string,
		readonly code: number,
	) {
		super(
			`The backup of ${project} failed (exit ${code}); its result is the last line above. ` +
				`docker logs on the ${BACKUPS_SERVICE} container shows every run.`,
		);
		this.name = 'BackupRunFailed';
	}
}

/** Restoring a database failed. */
export class RestoreFailed extends GkmError {
	constructor(
		readonly database: string,
		readonly code: number,
	) {
		super(
			`Restoring ${database} failed (psql exited ${code}); what it said is above. ` +
				'The backup taken before the restore is the newest in gkm backup:list.',
		);
		this.name = 'RestoreFailed';
	}
}

/**
 * A file's download from S3 ended before the whole object arrived. Nothing
 * was run against the database.
 */
export class BackupDownloadIncomplete extends GkmError {
	constructor(
		readonly url: string,
		readonly received: number,
		readonly expected: number,
	) {
		super(
			`Downloading ${url} stopped after ${received} of ${expected} ` +
				'bytes, so nothing was loaded. Run the restore again; if it keeps ' +
				'stopping, check the network between here and the bucket.',
		);
		this.name = 'BackupDownloadIncomplete';
	}
}

/** Every run under the prefix, newest first. Keys that are not a run's are skipped. */
export async function listBackups(
	s3: S3Client,
	bucket: string,
	prefix: string,
): Promise<BackupRun[]> {
	const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
	const runs = new Map<string, BackupRun>();
	let token: string | undefined;
	do {
		const page = await s3.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: `${prefix}/`,
				...(token ? { ContinuationToken: token } : {}),
			}),
		);
		for (const object of page.Contents ?? []) {
			const rest = object.Key?.slice(prefix.length + 1) ?? '';
			const match =
				/^(\d{4}-\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}Z)\/(.+)\.sql\.gz$/.exec(rest);
			const at = match ? runTime(match[1]!) : undefined;
			if (!match || !at) continue;
			const run = runs.get(match[1]!) ?? { folder: match[1]!, at, files: [] };
			run.files.push({ database: match[2]!, size: object.Size ?? 0 });
			runs.set(match[1]!, run);
		}
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
	for (const run of runs.values()) {
		run.files.sort((a, b) => a.database.localeCompare(b.database));
	}
	return [...runs.values()].sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** `1.2 MB`. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** The lines `backup:list` prints, newest first. */
export function formatRuns(runs: readonly BackupRun[]): string[] {
	return runs.map(
		(run) =>
			`${formatTime(run.at)}  ${run.folder}  ` +
			run.files.map((f) => `${f.database} (${formatSize(f.size)})`).join(', '),
	);
}

/**
 * Ask the stack's backups container for a backup now, and wait for it.
 *
 * @throws {BackupsContainerNotRunning}
 * @throws {BackupRunFailed}
 */
export async function backupNow(options: {
	docker: ComposeDocker;
	project: string;
	/** The stage's engine: its server's, over SSH, or this machine's. */
	engine?: DockerEngine;
	/** Each line the run printed — its result, as JSON. */
	log?: (line: string) => void;
}): Promise<void> {
	const result = await options.docker.exec(
		{
			project: options.project,
			file: '',
			cwd: process.cwd(),
			...(options.engine?.host ? { host: options.engine.host } : {}),
		},
		BACKUPS_SERVICE,
		['node', RUNNER_PATH, 'run'],
	);
	for (const line of `${result.stdout}${result.stderr}`.split('\n')) {
		if (line.trim()) options.log?.(line);
	}
	if (result.code === null) {
		throw new BackupsContainerNotRunning(options.project);
	}
	if (result.code !== 0)
		throw new BackupRunFailed(options.project, result.code);
}

/** The run `--at` or `--latest` names. */
export function chooseRun(
	runs: readonly BackupRun[],
	choice: { at?: string; latest?: boolean },
): BackupRun {
	if (choice.latest) return runs[0]!;
	const at = choice.at!;
	const exact = runs.find((run) => run.folder === at.replace(/^\/+|\/+$/g, ''));
	if (exact) return exact;
	const time = new Date(at);
	const found = Number.isNaN(time.getTime())
		? undefined
		: runs.find((run) => run.at.getTime() <= time.getTime());
	if (!found) {
		throw new BackupRunNotFound(
			at,
			runs.map((run) => run.folder),
		);
	}
	return found;
}

/**
 * What runs in the one-off container: no new connection to the database,
 * every open one closed, then the dump — which drops and recreates it — read
 * from stdin. A restore that fails lets connections in again.
 */
const RESTORE_SCRIPT = `set -e
allow() {
  printf '%s\\n' "SELECT format('ALTER DATABASE %I WITH ALLOW_CONNECTIONS ' || :'allow', datname) FROM pg_database WHERE datname = :'db' \\\\gexec" \\
    | psql -X -q -v ON_ERROR_STOP=1 -v db="$RESTORE_DATABASE" -v allow="$1" -o /dev/null
}
allow false
printf '%s\\n' "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();" \\
  | psql -X -q -v ON_ERROR_STOP=1 -v db="$RESTORE_DATABASE" -o /dev/null
if ! gunzip | psql -X -q -v ON_ERROR_STOP=1 -o /dev/null; then
  allow true || true
  exit 1
fi
`;

/**
 * What runs in the one-off container for `--from`: every other session of
 * the database ended — the stack's apps are already stopped, so nothing
 * comes back — then the file, a data-only dump, run connected to the
 * database itself, in one transaction. A file that fails changes nothing.
 */
const IMPORT_SCRIPT = `set -e
printf '%s\\n' "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();" \\
  | psql -X -q -v ON_ERROR_STOP=1 -v db="$RESTORE_DATABASE" -o /dev/null
gunzip | psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$RESTORE_DATABASE" -f - -o /dev/null
`;

export interface RestoreOptions {
	s3: S3Client;
	bucket: string;
	prefix: string;
	docker: ComposeDocker;
	project: string;
	/** The stage's engine: its server's, over SSH, or this machine's. */
	engine?: DockerEngine;
	stage: string;
	/** The stack's superuser: what recreates each database. */
	superuser: { user: string; password: string };
	/** The stack's databases. */
	databases: readonly BackupDatabase[];
	at?: string;
	latest?: boolean;
	/**
	 * A prepared, data-only file in the prefix's `imports/` —
	 * `imports/app.sql.gz` — loaded into `database` instead of a run.
	 */
	from?: string;
	/** One database, by its file name: `auth-database`. Every one when absent. */
	database?: string;
	/**
	 * The stack's services left running while `from` loads: its
	 * infrastructure. Every other container — its apps, workers and
	 * processors — is stopped, and started again after. Postgres and the
	 * backups container are always kept.
	 */
	keep?: readonly string[];
	/** Asked before anything changes; false stops the restore. */
	confirm: (question: string) => Promise<boolean>;
	log: (line: string) => void;
	output?: StackRef['output'];
}

/**
 * Restore a run's databases into the stack's Postgres — or, with `from`,
 * load a prepared import into one. Asks, takes a fresh backup, then
 * recreates each database from its file. Returns the run (or the import)
 * and the databases restored.
 *
 * @throws {BackupRunNotChosen}, {NoBackups}, {BackupRunNotFound},
 *   {ImportPathInvalid}, {ImportNeedsDatabase}, {ImportNotFound},
 *   {BackupDatabaseUnknown}, {BackupDatabaseMissing}, {RestoreNotConfirmed},
 *   {BackupsContainerNotRunning}, {BackupRunFailed}, {RestoreFailed},
 *   {ContainersNotStopped}, {AppsNotRestarted}
 */
export async function restoreBackup(
	options: RestoreOptions,
): Promise<{ run?: BackupRun; from?: string; restored: string[] }> {
	const chosen = [options.at, options.latest, options.from].filter(Boolean);
	if (chosen.length !== 1) throw new BackupRunNotChosen();
	if (options.from) return importBackup({ ...options, from: options.from });

	const runs = await listBackups(options.s3, options.bucket, options.prefix);
	if (runs.length === 0) {
		throw new NoBackups(
			options.stage,
			`s3://${options.bucket}/${options.prefix}/`,
		);
	}
	const run = chooseRun(runs, options);

	const known = options.databases.map((d) => d.file);
	if (options.database && !known.includes(options.database)) {
		throw new BackupDatabaseUnknown(options.database, known);
	}
	const targets = options.databases.filter(
		(d) => !options.database || d.file === options.database,
	);
	const has = run.files.map((f) => f.database);
	for (const target of targets) {
		if (!has.includes(target.file)) {
			throw new BackupDatabaseMissing(run.folder, target.file, has);
		}
	}

	const { engine, image } = await beforeRestore(
		options,
		`Replace ${targets.map((t) => t.name).join(', ')} on '${options.stage}' ` +
			`with the backup ${run.folder}? Everything written since is lost (a backup ` +
			'is taken first).',
	);

	const restored: string[] = [];
	for (const target of targets) {
		const Key = `${options.prefix}/${run.folder}/${backupFile(target)}`;
		options.log(
			`♻️  Restoring ${target.name} from s3://${options.bucket}/${Key}…`,
		);
		const file = await download(options, Key);
		let code: number;
		try {
			code = await loadInto(options, engine, image, {
				path: file.path,
				script: RESTORE_SCRIPT,
				database: target.name,
			});
		} finally {
			await file.remove();
		}
		if (code !== 0) throw new RestoreFailed(target.name, code);
		restored.push(target.file);
	}
	return { run, restored };
}

/**
 * Load `from` — a data-only file in the prefix's `imports/` — into one
 * database. The file has to run connected to the database itself, so the
 * database cannot be closed to connections the way a run's restore closes it
 * (that would shut the load out too); the stack's apps are stopped instead,
 * and started again whatever happens.
 */
async function importBackup(
	options: RestoreOptions & { from: string },
): Promise<{ from: string; restored: string[] }> {
	const Key = importKey(options.prefix, options.from);
	const known = options.databases.map((d) => d.file);
	if (!options.database) throw new ImportNeedsDatabase(options.from, known);
	const target = options.databases.find((d) => d.file === options.database);
	if (!target) throw new BackupDatabaseUnknown(options.database, known);

	const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
	try {
		await options.s3.send(
			new HeadObjectCommand({ Bucket: options.bucket, Key }),
		);
	} catch (error) {
		const status = (error as { $metadata?: { httpStatusCode?: number } })
			.$metadata?.httpStatusCode;
		if (status !== 404) throw error;
		throw new ImportNotFound(
			options.from,
			`s3://${options.bucket}/${options.prefix}/`,
		);
	}

	const { engine, image } = await beforeRestore(
		options,
		`Load ${options.from} into ${target.name} on '${options.stage}'? Its apps ` +
			'are stopped while it loads, and what the file replaces is lost (a ' +
			'backup is taken first).',
	);

	// The whole file is here before the apps stop: a slow or broken download
	// costs no downtime, and never reaches the database half-read.
	options.log(`📥 Downloading s3://${options.bucket}/${Key}…`);
	const file = await download(options, Key);
	try {
		return await loadImport(options, engine, image, target, file.path);
	} finally {
		await file.remove();
	}
}

/** Stop the stack's apps, load the downloaded import, start them again. */
async function loadImport(
	options: RestoreOptions & { from: string },
	engine: DockerEngine,
	image: string,
	target: BackupDatabase,
	path: string,
): Promise<{ from: string; restored: string[] }> {
	const keep = ['postgres', BACKUPS_SERVICE, ...(options.keep ?? [])];
	options.log(`⏸️  Stopping ${options.project}'s apps…`);
	let stopped: string[];
	try {
		stopped = await options.docker.stop(engine, options.project, keep);
	} catch (error) {
		// Nothing has changed yet: whatever did stop starts again.
		if (error instanceof ContainersNotStopped) {
			await options.docker.start(engine, error.ids).catch(() => {});
		}
		throw error;
	}

	let code: number;
	try {
		options.log(`📥 Loading ${target.name} from ${options.from}…`);
		code = await loadInto(options, engine, image, {
			path,
			script: IMPORT_SCRIPT,
			database: target.name,
		});
	} catch (error) {
		await options.docker.start(engine, stopped).catch(() => {});
		throw error;
	}

	options.log(`▶️  Starting ${options.project}'s apps again…`);
	try {
		await options.docker.start(engine, stopped);
	} catch (error) {
		throw new AppsNotRestarted(
			options.project,
			target.name,
			code === 0,
			stopped,
			error instanceof ContainersNotStarted ? error.output : String(error),
		);
	}
	if (code !== 0) throw new RestoreFailed(target.name, code);
	return { from: options.from, restored: [target.file] };
}

/**
 * What every restore does before it changes anything: find the stack's
 * backups container — its image runs the restore — ask, and take a fresh
 * backup.
 */
async function beforeRestore(
	options: RestoreOptions,
	question: string,
): Promise<{ engine: DockerEngine; image: string }> {
	const engine: DockerEngine = options.engine ?? {};
	const container = await options.docker.container(
		engine,
		options.project,
		BACKUPS_SERVICE,
	);
	if (!container) throw new BackupsContainerNotRunning(options.project);

	if (!(await options.confirm(question))) {
		throw new RestoreNotConfirmed(options.stage);
	}

	options.log('💾 Taking a backup before restoring…');
	await backupNow({
		docker: options.docker,
		project: options.project,
		engine,
		log: options.log,
	});
	return { engine, image: container.image };
}

/**
 * Download a file from S3, with the caller's credentials, to a private
 * temporary folder, and check every byte arrived. A restore never streams
 * straight from S3 into the container: over a remote engine the container's
 * stdin applies backpressure for as long as psql takes, and an S3 response
 * held open that long can be cut off — leaving gunzip a truncated file.
 *
 * @throws {BackupDownloadIncomplete}
 */
async function download(
	options: RestoreOptions,
	Key: string,
): Promise<{ path: string; remove: () => Promise<void> }> {
	const { GetObjectCommand } = await import('@aws-sdk/client-s3');
	const dir = await mkdtemp(join(tmpdir(), 'gkm-restore-'));
	const remove = () => rm(dir, { recursive: true, force: true });
	const path = join(dir, 'file');
	const url = `s3://${options.bucket}/${Key}`;
	try {
		const object = await options.s3.send(
			new GetObjectCommand({ Bucket: options.bucket, Key }),
		);
		let received = 0;
		const body = object.Body as Readable;
		body.on('data', (chunk: Buffer) => {
			received += chunk.length;
		});
		await pipeline(body, createWriteStream(path, { mode: 0o600 })).catch(
			(error) => {
				if (object.ContentLength === undefined) throw error;
				throw new BackupDownloadIncomplete(url, received, object.ContentLength);
			},
		);
		if (
			object.ContentLength !== undefined &&
			received !== object.ContentLength
		) {
			throw new BackupDownloadIncomplete(url, received, object.ContentLength);
		}
		return { path, remove };
	} catch (error) {
		await remove();
		throw error;
	}
}

/**
 * Stream a downloaded file into `script` in a one-off container of the
 * backups image on the stack's network, signed in as the stack's superuser.
 * Resolves with its exit code.
 */
async function loadInto(
	options: RestoreOptions,
	engine: DockerEngine,
	image: string,
	file: { path: string; script: string; database: string },
): Promise<number> {
	return options.docker.runOnce(engine, {
		image,
		network: projectNetwork(options.project),
		command: ['sh', '-c', file.script],
		env: {
			PGHOST: 'postgres',
			PGPORT: '5432',
			PGUSER: options.superuser.user,
			PGPASSWORD: options.superuser.password,
			PGDATABASE: 'postgres',
			RESTORE_DATABASE: file.database,
		},
		stdin: createReadStream(file.path),
		...(options.output ? { output: options.output } : {}),
	});
}

// ============================================================================
// The commands: a stage resolved from the workspace
// ============================================================================

export interface BackupCommandOptions {
	stage: string;
	cwd?: string;
	profile?: string;
}

/** Everything a backup command reads about a stage. */
interface ResolvedStage {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	project: string;
	prefix: string;
	databases: BackupDatabase[];
	custom: Readonly<Record<string, string>>;
	seed?: string;
	/** The stage's server's Docker, over SSH. */
	engine: DockerEngine;
}

async function resolveStage(
	options: BackupCommandOptions,
): Promise<ResolvedStage> {
	const { workspace } = await loadWorkspaceConfig(options.cwd);
	const { stage } = options;
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
	});
	const choice = stageBackups(workspace, manifest, stage);
	if (choice.mode === 'disabled') {
		throw new BackupsNotOn(stage, `deploy.backups.${stage} is false`);
	}
	if (choice.mode === 'none') {
		throw new BackupsNotOn(
			stage,
			choice.reason === 'local'
				? 'it is the local stage'
				: choice.reason === 'no-postgres'
					? 'its stack runs no Postgres'
					: 'the compose target does not deploy it',
		);
	}
	const store = await secretsStoreFor(workspace, stage);
	const secrets = await store.read(stage);
	return {
		workspace,
		manifest,
		project: composeProject(deployIdentity(workspace, stage)),
		prefix: backupsPrefix(workspace, stage),
		databases: backupDatabases(stackPlan(workspace, manifest, stage).resources),
		custom: secrets?.custom ?? {},
		...(secrets?.seed ? { seed: secrets.seed } : {}),
		engine: stageEngine(workspace, stage, secrets?.custom),
	};
}

/** The stage's server's Docker engine, as every deploy of it reaches it. */
function stageEngine(
	workspace: NormalizedWorkspace,
	stage: string,
	custom: Readonly<Record<string, string>> | undefined,
): DockerEngine {
	const server = composeServer({
		stage,
		local: false,
		config: workspace.deploy?.compose?.server,
		custom,
	});
	return server ? { host: dockerHost(server) } : {};
}

/**
 * The bucket and region the stage's backups are in — read off its
 * `BACKUPS_URL` — and an S3 client with the caller's own credentials.
 */
async function callerS3(
	resolved: ResolvedStage,
	options: BackupCommandOptions,
): Promise<{ s3: S3Client; bucket: string }> {
	const url = resolved.custom[BACKUPS_URL_KEY];
	if (!url) throw new BackupsNotProvisioned(options.stage);
	const s3Url = await import('@geekmidas/storage/s3-url');
	const address = s3Url.parse(url);
	const credential = (await awsProvisioningCredentials({
		stage: options.stage,
		env: process.env,
		...(options.profile ? { profile: options.profile } : {}),
	})) ?? { chain: true as const };
	const region = address.region ?? 'us-east-1';
	const config = await awsClientConfig(credential, region);
	const endpoint = awsEndpoint(process.env, 'S3');
	const { S3Client } = await import('@aws-sdk/client-s3');
	return {
		s3: new S3Client({
			...config,
			...(endpoint ? { endpoint, forcePathStyle: true } : {}),
		}),
		bucket: address.bucket,
	};
}

/** What `gkm backup:list` finds: the runs, and the imports beside them. */
export interface BackupListing {
	runs: BackupRun[];
	imports: BackupImport[];
}

/** `gkm backup:list --stage <stage>`. */
export async function backupListCommand(
	options: BackupCommandOptions & { json?: boolean },
): Promise<BackupListing> {
	const resolved = await resolveStage(options);
	const { s3, bucket } = await callerS3(resolved, options);
	const runs = await listBackups(s3, bucket, resolved.prefix);
	const imports = await listImports(s3, bucket, resolved.prefix);
	if (options.json) {
		console.log(JSON.stringify({ runs, imports }, null, 2));
		return { runs, imports };
	}
	if (runs.length === 0) {
		console.log(`No backups of '${options.stage}' yet.`);
	} else {
		console.log(`💾 s3://${bucket}/${resolved.prefix}/ — newest first\n`);
		for (const line of formatRuns(runs)) console.log(line);
	}
	if (imports.length > 0) {
		console.log(
			`\n📥 Imports — gkm backup:restore --stage ${options.stage} --from <file> --database <name>\n`,
		);
		for (const line of formatImports(imports)) console.log(line);
	}
	return { runs, imports };
}

/** `gkm backup:now --stage <stage>`. */
export async function backupNowCommand(
	options: BackupCommandOptions,
	docker: ComposeDocker = dockerCompose,
): Promise<void> {
	const resolved = await resolveStage(options);
	console.log(`💾 Backing up ${resolved.project}…`);
	await backupNow({
		docker,
		project: resolved.project,
		engine: resolved.engine,
		log: (line) => console.log(line),
	});
	console.log('✅ Backed up.');
}

/** The stack's own proxy: kept running while an import loads. */
const STACK_PROXY_SERVICE = 'caddy';

/**
 * `gkm backup:restore --stage <stage> (--at <time> | --latest |
 * --from imports/<file> --database <name>)`.
 */
export async function backupRestoreCommand(
	options: BackupCommandOptions & {
		at?: string;
		latest?: boolean;
		from?: string;
		database?: string;
		yes?: boolean;
	},
	docker: ComposeDocker = dockerCompose,
): Promise<void> {
	// What the flags alone refuse, refused before the stage is read.
	const chosen = [options.at, options.latest, options.from].filter(Boolean);
	if (chosen.length !== 1) throw new BackupRunNotChosen();
	if (options.from) importKey('', options.from);
	const resolved = await resolveStage(options);
	if (options.from && !options.database) {
		throw new ImportNeedsDatabase(
			options.from,
			resolved.databases.map((d) => d.file),
		);
	}
	const { s3, bucket } = await callerS3(resolved, options);
	if (!resolved.seed) throw new BackupsNotProvisioned(options.stage);
	const plan = stackPlan(resolved.workspace, resolved.manifest, options.stage);
	const superuser = derivedCredentials(
		resolved.workspace.name,
		plan,
		resolved.seed,
	).postgres;

	const { run, restored } = await restoreBackup({
		s3,
		bucket,
		prefix: resolved.prefix,
		docker,
		project: resolved.project,
		engine: resolved.engine,
		stage: options.stage,
		superuser,
		databases: resolved.databases,
		// The stack's infrastructure keeps running while an import loads.
		keep: [...plan.containers, STACK_PROXY_SERVICE],
		...(options.at ? { at: options.at } : {}),
		...(options.latest ? { latest: true } : {}),
		...(options.from ? { from: options.from } : {}),
		...(options.database ? { database: options.database } : {}),
		confirm: async (question) => {
			if (options.yes) return true;
			const answer = await prompt(`${question} [y/N] `, {
				instead: 'Pass --yes to restore without asking.',
			});
			return /^y(es)?$/i.test(answer.trim());
		},
		log: (line) => console.log(line),
	});
	console.log(
		`✅ Restored ${restored.join(', ')} on '${options.stage}' from ${run ? run.folder : options.from}.`,
	);
}
