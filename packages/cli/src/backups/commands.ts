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
 */

import type { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import type { ConstructManifest } from '@geekmidas/manifest';
import {
	type ComposeDocker,
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

/** `--at` and `--latest` together, or neither. */
export class BackupRunNotChosen extends GkmError {
	constructor() {
		super(
			'Say which backup to restore: --latest, or --at <time> — a run folder ' +
				'(2026-10-10/02-00-00Z) or a time, for the newest run at or before it.',
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
			`${run.at
				.toISOString()
				.replace('T', ' ')
				.replace(/\.\d{3}Z$/, 'Z')}  ${run.folder}  ` +
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
	/** One database, by its file name: `auth-database`. Every one when absent. */
	database?: string;
	/** Asked before anything changes; false stops the restore. */
	confirm: (question: string) => Promise<boolean>;
	log: (line: string) => void;
	output?: StackRef['output'];
}

/**
 * Restore a run's databases into the stack's Postgres. Asks, takes a fresh
 * backup, then recreates each database from its file. Returns the run and
 * the databases restored.
 *
 * @throws {BackupRunNotChosen}, {NoBackups}, {BackupRunNotFound},
 *   {BackupDatabaseUnknown}, {BackupDatabaseMissing}, {RestoreNotConfirmed},
 *   {BackupsContainerNotRunning}, {BackupRunFailed}, {RestoreFailed}
 */
export async function restoreBackup(
	options: RestoreOptions,
): Promise<{ run: BackupRun; restored: string[] }> {
	if (Boolean(options.at) === Boolean(options.latest)) {
		throw new BackupRunNotChosen();
	}
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

	const engine: DockerEngine = options.engine ?? {};
	const container = await options.docker.container(
		engine,
		options.project,
		BACKUPS_SERVICE,
	);
	if (!container) throw new BackupsContainerNotRunning(options.project);

	const question =
		`Replace ${targets.map((t) => t.name).join(', ')} on '${options.stage}' ` +
		`with the backup ${run.folder}? Everything written since is lost (a backup ` +
		'is taken first).';
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

	const { GetObjectCommand } = await import('@aws-sdk/client-s3');
	const restored: string[] = [];
	for (const target of targets) {
		const Key = `${options.prefix}/${run.folder}/${backupFile(target)}`;
		options.log(
			`♻️  Restoring ${target.name} from s3://${options.bucket}/${Key}…`,
		);
		const object = await options.s3.send(
			new GetObjectCommand({ Bucket: options.bucket, Key }),
		);
		const code = await options.docker.runOnce(engine, {
			image: container.image,
			network: projectNetwork(options.project),
			command: ['sh', '-c', RESTORE_SCRIPT],
			env: {
				PGHOST: 'postgres',
				PGPORT: '5432',
				PGUSER: options.superuser.user,
				PGPASSWORD: options.superuser.password,
				PGDATABASE: 'postgres',
				RESTORE_DATABASE: target.name,
			},
			stdin: object.Body as Readable,
			...(options.output ? { output: options.output } : {}),
		});
		if (code !== 0) throw new RestoreFailed(target.name, code);
		restored.push(target.file);
	}
	return { run, restored };
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

/** `gkm backup:list --stage <stage>`. */
export async function backupListCommand(
	options: BackupCommandOptions & { json?: boolean },
): Promise<BackupRun[]> {
	const resolved = await resolveStage(options);
	const { s3, bucket } = await callerS3(resolved, options);
	const runs = await listBackups(s3, bucket, resolved.prefix);
	if (options.json) {
		console.log(JSON.stringify(runs, null, 2));
	} else if (runs.length === 0) {
		console.log(`No backups of '${options.stage}' yet.`);
	} else {
		console.log(`💾 s3://${bucket}/${resolved.prefix}/ — newest first\n`);
		for (const line of formatRuns(runs)) console.log(line);
	}
	return runs;
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

/** `gkm backup:restore --stage <stage> (--at <time> | --latest)`. */
export async function backupRestoreCommand(
	options: BackupCommandOptions & {
		at?: string;
		latest?: boolean;
		database?: string;
		yes?: boolean;
	},
	docker: ComposeDocker = dockerCompose,
): Promise<void> {
	if (Boolean(options.at) === Boolean(options.latest)) {
		throw new BackupRunNotChosen();
	}
	const resolved = await resolveStage(options);
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
		...(options.at ? { at: options.at } : {}),
		...(options.latest ? { latest: true } : {}),
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
		`✅ Restored ${restored.join(', ')} on '${options.stage}' from ${run.folder}.`,
	);
}
