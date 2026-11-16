/**
 * The stack's `backups` service: what a deployed compose stage with Postgres
 * runs beside its apps, unless `deploy.backups.<stage>` is `false`.
 *
 * - **The image** is built from the stack's own Postgres image —
 *   `postgres:<major>-alpine`, already on the server for the stack, and with
 *   the `pg_dump` that matches the server — with Node added and gkm's runner
 *   (`runner.ts`) copied in. Nothing is pulled that the stack does not have,
 *   and nothing is mounted from the host: the build context is two files.
 * - **Its key** is `BACKUPS_URL`, from the stage's secrets, like any app's:
 *   allowed to put objects under the stage's backups prefix and nothing else.
 *   The server holds no AWS credentials of its own.
 * - **Its login** is a role of its own, `<project>_backups`, granted
 *   `pg_read_all_data` — it can read every database and write none. Postgres
 *   before 14 has no such role, and there it signs in as the stack's
 *   superuser.
 * - **Its health** is the last good run: unhealthy once that is more than
 *   twice the schedule's longest gap old, after a startup grace.
 *
 * With `pitr`, point-in-time recovery runs beside the dumps:
 *
 * - **The stack's Postgres** is built from its own image with WAL-G added —
 *   compiled from source in a build stage, statically, so it runs on any
 *   base — and archives its WAL: `wal_level=replica`, `archive_mode=on`,
 *   `archive_command='wal-g wal-push %p'`, `archive_timeout=60`. WAL-G reads
 *   the backups key and `PITR_KEY` from its own env file, `postgres.env`.
 * - **The backups service** gets the same WAL-G, the data volume mounted
 *   read-only, and takes a base backup (`wal-g backup-push`) on `pitr.base`'s
 *   schedule. Its health also reads `pg_stat_archiver`.
 * - **Everything is encrypted** client-side (libsodium) with `PITR_KEY`, a
 *   stage secret the deploy generates once, so the bucket never holds
 *   readable WAL.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DEFAULT_POSTGRES_VERSION,
	type PostgresVersion,
} from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';
import { GkmError } from '../errors';
import { declaredPostgresImage, POSTGRES_MOUNT } from '../reconcile/compose.js';
import { postgresImage, volumeOf } from '../reconcile/containers.js';
import { localRolePassword } from '../reconcile/env.js';
import { postgresRoleSlug } from '../reconcile/localCredentials.js';
import type { Plan } from '../reconcile/plan.js';
import { quoteIdentifier, type Statement } from '../reconcile/provision.js';
import {
	type BackupDatabase,
	type BackupsWorkspace,
	backupDatabases,
	backupsPrefix,
	pitrPrefix,
} from './config.js';
import type { StageBackups, StagePitr } from './schedule.js';

/** The service's name in the stack. */
export const BACKUPS_SERVICE = 'backups';

/** The secret its key is written to. */
export const BACKUPS_URL_KEY = 'BACKUPS_URL';

/** The secret WAL and base backups are encrypted with: 32 bytes, hex. */
export const PITR_KEY = 'PITR_KEY';

/** A new {@link PITR_KEY}: random, generated once, kept in the stage. */
export function newPitrKey(): string {
	return randomBytes(32).toString('hex');
}

/** The stack's Postgres service, which archives its WAL with `pitr`. */
export const POSTGRES_SERVICE = 'postgres';

/** The WAL-G release built into the images. */
export const WALG_VERSION = 'v3.0.9';

/** Where WAL-G is, in either image. */
export const WALG_PATH = '/usr/local/bin/wal-g';

/** The settings that make Postgres archive its WAL through WAL-G. */
export const ARCHIVE_SETTINGS: Readonly<Record<string, string>> = {
	wal_level: 'replica',
	archive_mode: 'on',
	archive_command: 'wal-g wal-push %p',
	// A segment ships at least each minute, even when writes are quiet.
	archive_timeout: '60',
};

/** Where the runner is, in the image. */
export const RUNNER_PATH = '/gkm/backup.mjs';

/** The first Postgres with `pg_read_all_data`. */
const READ_ALL_DATA_SINCE = 14;

/** A stage with point-in-time recovery, and no key to encrypt it with. */
export class PitrKeyMissing extends GkmError {
	constructor(readonly stage: string) {
		super(
			`deploy.backups.${stage}.pitr is on, and the stage's secrets hold no ` +
				`${PITR_KEY} to encrypt its WAL and base backups with. The deploy ` +
				"generates it, beside BACKUPS_URL — run the deploy with the stage's " +
				'AWS credentials.',
		);
		this.name = 'PitrKeyMissing';
	}
}

/** A stage that backs up, and no key to back up with. */
export class BackupsUrlMissing extends GkmError {
	constructor(readonly stage: string) {
		super(
			`'${stage}' runs Postgres, so its stack backs it up, and its secrets ` +
				`hold no ${BACKUPS_URL_KEY} to back up with. The deploy writes it — ` +
				"the IAM user and key it creates in the stage's AWS account — so " +
				'run the deploy with the ' +
				"account's credentials. To take no backups on this stage, set " +
				`deploy.backups.${stage}: false.`,
		);
		this.name = 'BackupsUrlMissing';
	}
}

/** The backups role: `<project>_backups`, as the superuser is `<project>_admin`. */
export function backupsRole(project: string): string {
	return `${postgresRoleSlug(project)}_backups`;
}

/** The stack's backups, as its compose file and env file have them. */
export interface StackBackups {
	backups: StageBackups;
	databases: BackupDatabase[];
	/** `gkm/<project>/<stage>/backups`. */
	prefix: string;
	/** The Postgres image it is built from. */
	from: string;
	/** The stack's Postgres major. */
	version: PostgresVersion;
	/** `<project>-backups:pg18-<hash>`: built on the server, never pushed. */
	image: string;
	/** Its build context: the Dockerfile and the runner. */
	files: { Dockerfile: string; 'backup.mjs': string };
	/** What it signs in to Postgres as. */
	login: { user: string; password: string };
	/** Whether that is its own read-only role (else the superuser). */
	readOnly: boolean;
	/** Its environment — empty in a stack that only builds. */
	env: Record<string, string>;
	/** Point-in-time recovery, when the stage's entry turns it on. */
	pitr?: StackPitr;
}

/** The stack's point-in-time recovery: its Postgres image, and WAL-G's env. */
export interface StackPitr {
	pitr: StagePitr;
	/** `gkm/<project>/<stage>/backups/pitr`. */
	prefix: string;
	/** The stack's Postgres, with WAL-G: built on the server, never pushed. */
	postgres: {
		/** The image it is built from: the stack's own Postgres image. */
		from: string;
		/** `<project>-postgres:pg18-<hash>`. */
		image: string;
		files: { Dockerfile: string };
		/** What Postgres runs: its archive settings. */
		command: string[];
		/** WAL-G's environment, for `archive_command` — empty in a stack that only builds. */
		env: Record<string, string>;
	};
}

/**
 * The runner's source, as JavaScript: the built `backups/runner.mjs` beside
 * the CLI's bundle, or — run from source — `runner.ts`, with its types
 * stripped by esbuild.
 */
export function runnerSource(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	for (const path of [
		join(here, 'backups', 'runner.mjs'),
		join(here, 'runner.mjs'),
		join(here, '..', 'backups', 'runner.mjs'),
	]) {
		if (existsSync(path)) return readFileSync(path, 'utf-8');
	}
	const { transformSync } = createRequire(import.meta.url)(
		'esbuild',
	) as typeof import('esbuild');
	return transformSync(readFileSync(join(here, 'runner.ts'), 'utf-8'), {
		loader: 'ts',
		format: 'esm',
		target: 'node22',
	}).code;
}

/**
 * The build stage both images copy WAL-G from: built from source at
 * {@link WALG_VERSION}, with libsodium for its encryption, linked statically
 * so it runs on whatever base the stack's Postgres image has. The same text
 * in both Dockerfiles, so the second build is the first's cache.
 */
export function walgStage(): string {
	return `FROM golang:1-alpine AS wal-g
RUN apk add --no-cache build-base git libsodium-dev libsodium-static
RUN git clone --depth 1 --branch ${WALG_VERSION} https://github.com/wal-g/wal-g.git /src
WORKDIR /src/main/pg
ENV GOTOOLCHAIN=auto CGO_ENABLED=1
RUN go build -tags libsodium -ldflags '-s -w -linkmode external -extldflags "-static"' -o /wal-g .
`;
}

/**
 * The image's Dockerfile: the stack's Postgres, Node, and the runner — and,
 * with `pitr`, WAL-G.
 */
export function backupsDockerfile(from: string, pitr = false): string {
	return `# Generated by gkm — the stage's backups: pg_dump from ${from}, and gkm's uploader${pitr ? ', and WAL-G' : ''}.
${pitr ? `${walgStage()}\n` : ''}FROM ${from}
RUN apk add --no-cache nodejs
${pitr ? `COPY --from=wal-g /wal-g ${WALG_PATH}\n` : ''}COPY backup.mjs ${RUNNER_PATH}
USER postgres
ENTRYPOINT []
CMD ["node", "${RUNNER_PATH}", "serve"]
`;
}

/** The stack's Postgres image, with WAL-G added for `archive_command`. */
export function pitrPostgresDockerfile(from: string): string {
	return `# Generated by gkm — the stage's Postgres, ${from}, with WAL-G: it archives its WAL.
${walgStage()}
FROM ${from}
COPY --from=wal-g /wal-g ${WALG_PATH}
`;
}

/** What Postgres runs with `pitr`: the image's own command, and the archive settings. */
export function pitrPostgresCommand(): string[] {
	return [
		'postgres',
		...Object.entries(ARCHIVE_SETTINGS).flatMap(([name, value]) => [
			'-c',
			`${name}=${value}`,
		]),
	];
}

/**
 * WAL-G's environment, from the stage's backups key and its PITR key:
 * where the archive is, as whom it is put, and the key it is encrypted with.
 * The restore builds the same from the caller's own credentials.
 */
export function walgEnv(input: {
	bucket: string;
	region?: string;
	endpoint?: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	sessionToken?: string;
	prefix: string;
	key: string;
}): Record<string, string> {
	return {
		WALG_S3_PREFIX: `s3://${input.bucket}/${input.prefix}`,
		AWS_REGION: input.region ?? 'us-east-1',
		...(input.endpoint
			? { AWS_ENDPOINT: input.endpoint, AWS_S3_FORCE_PATH_STYLE: 'true' }
			: {}),
		...(input.accessKeyId && input.secretAccessKey
			? {
					AWS_ACCESS_KEY_ID: input.accessKeyId,
					AWS_SECRET_ACCESS_KEY: input.secretAccessKey,
				}
			: {}),
		...(input.sessionToken ? { AWS_SESSION_TOKEN: input.sessionToken } : {}),
		WALG_LIBSODIUM_KEY: input.key,
		WALG_LIBSODIUM_KEY_TRANSFORM: 'hex',
		WALG_COMPRESSION_METHOD: 'lz4',
	};
}

export interface StackBackupsInput {
	workspace: BackupsWorkspace;
	stage: string;
	project: string;
	plan: Plan;
	backups: StageBackups;
	/** The stage's secrets, by key. */
	custom: Readonly<Record<string, string>>;
	seed: string;
	/** The stack's superuser. */
	superuser: { user: string; password: string };
	/** What the stage's telemetry hands a process, when it is on. */
	telemetry?: Readonly<Record<string, string>>;
	/** The stack only builds: no environment, no key needed. */
	buildOnly?: boolean;
}

/**
 * The stack's backups service, for a stage whose backups are on.
 *
 * @throws {BackupsUrlMissing} when the stage's secrets hold no key
 * @throws {PitrKeyMissing} with `pitr`, when they hold no PITR key
 */
export function stackBackups(input: StackBackupsInput): StackBackups {
	const { plan, stage } = input;
	const pitr = input.backups.pitr;
	const version =
		plan.resources.find((r) => r.version)?.version ?? DEFAULT_POSTGRES_VERSION;
	const from = postgresImage(version);
	const script = runnerSource();
	const dockerfile = backupsDockerfile(from, pitr !== undefined);
	const hash = createHash('sha256')
		.update(dockerfile)
		.update(script)
		.digest('hex')
		.slice(0, 12);

	const readOnly = version >= READ_ALL_DATA_SINCE;
	const role = backupsRole(input.workspace.name);
	const login = readOnly
		? {
				user: role,
				password: localRolePassword(
					input.workspace.name,
					plan,
					role,
					input.seed,
				),
			}
		: input.superuser;

	const databases = backupDatabases(plan.resources);
	const prefix = backupsPrefix(input.workspace, stage);
	const { kind, ...schedule } = input.backups.schedule;

	const archive = pitr ? pitrPrefix(input.workspace, stage) : undefined;
	let walg: Record<string, string> = {};
	let env: Record<string, string> = {};
	if (!input.buildOnly) {
		const url = input.custom[BACKUPS_URL_KEY];
		if (!url) throw new BackupsUrlMissing(stage);
		if (pitr && archive) {
			const key = input.custom[PITR_KEY];
			if (!key) throw new PitrKeyMissing(stage);
			const address = s3Url.parse(url);
			walg = walgEnv({
				bucket: address.bucket,
				...(address.region ? { region: address.region } : {}),
				...(address.endpoint ? { endpoint: address.endpoint } : {}),
				...(address.accessKeyId ? { accessKeyId: address.accessKeyId } : {}),
				...(address.secretAccessKey
					? { secretAccessKey: address.secretAccessKey }
					: {}),
				prefix: archive,
				key,
			});
		}
		env = {
			BACKUPS_URL: url,
			BACKUPS_PREFIX: prefix,
			BACKUPS_DATABASES: JSON.stringify(
				databases.map(({ file, name }) => ({ file, name })),
			),
			BACKUPS_SCHEDULE: JSON.stringify(
				kind === 'cron'
					? {
							kind,
							minutes: input.backups.schedule.minutes,
							hours: input.backups.schedule.hours,
							days: input.backups.schedule.days,
							months: input.backups.schedule.months,
							weekdays: input.backups.schedule.weekdays,
						}
					: { kind, ...schedule },
			),
			BACKUPS_MAX_GAP_SECONDS: String(input.backups.maxGapSeconds),
			...(pitr
				? {
						PITR_BASE_SCHEDULE: JSON.stringify(pitr.base),
						PITR_BASE_MAX_GAP_SECONDS: String(pitr.base.seconds),
						...walg,
					}
				: {}),
			PGHOST: 'postgres',
			PGPORT: '5432',
			PGUSER: login.user,
			PGPASSWORD: login.password,
			...(input.telemetry?.OTEL_EXPORTER_OTLP_ENDPOINT
				? {
						OTEL_EXPORTER_OTLP_ENDPOINT:
							input.telemetry.OTEL_EXPORTER_OTLP_ENDPOINT,
						...(input.telemetry.OTEL_EXPORTER_OTLP_HEADERS
							? {
									OTEL_EXPORTER_OTLP_HEADERS:
										input.telemetry.OTEL_EXPORTER_OTLP_HEADERS,
								}
							: {}),
						OTEL_SERVICE_NAME: BACKUPS_SERVICE,
					}
				: {}),
		};
	}

	return {
		backups: input.backups,
		databases,
		prefix,
		from,
		version,
		image: `${input.project}-backups:pg${version}-${hash}`,
		files: { Dockerfile: dockerfile, 'backup.mjs': script },
		login,
		readOnly,
		env,
		...(pitr && archive
			? { pitr: stackPitr(input.project, plan, version, pitr, archive, walg) }
			: {}),
	};
}

/** The stack's Postgres with WAL-G, built from the stack's own image. */
function stackPitr(
	project: string,
	plan: Plan,
	version: PostgresVersion,
	pitr: StagePitr,
	prefix: string,
	env: Record<string, string>,
): StackPitr {
	const from = declaredPostgresImage(plan) ?? postgresImage(version);
	const dockerfile = pitrPostgresDockerfile(from);
	const hash = createHash('sha256')
		.update(dockerfile)
		.digest('hex')
		.slice(0, 12);
	return {
		pitr,
		prefix,
		postgres: {
			from,
			image: `${project}-postgres:pg${version}-${hash}`,
			files: { Dockerfile: dockerfile },
			command: pitrPostgresCommand(),
			env,
		},
	};
}

/**
 * The stack's Postgres service made to archive its WAL: built from its own
 * image with WAL-G, run with the archive settings, and handed WAL-G's
 * environment from its own env file.
 */
export function withArchiving<S extends { image: string }>(
	postgres: S,
	pitr: StackPitr,
	envFiles: boolean,
) {
	return {
		...postgres,
		image: pitr.postgres.image,
		build: { context: `./${POSTGRES_SERVICE}`, dockerfile: 'Dockerfile' },
		pull_policy: 'build' as const,
		command: pitr.postgres.command,
		...(envFiles
			? {
					env_file: [
						{ path: `./${POSTGRES_SERVICE}.env`, format: 'raw' as const },
					],
				}
			: {}),
	};
}

/** The service in the stack's compose file. */
export function backupsService(backups: StackBackups, envFiles: boolean) {
	return {
		image: backups.image,
		// Built on the server from two files; there is nothing to pull.
		build: { context: `./${BACKUPS_SERVICE}`, dockerfile: 'Dockerfile' },
		pull_policy: 'build' as const,
		restart: 'unless-stopped',
		...(envFiles
			? {
					env_file: [
						{ path: `./${BACKUPS_SERVICE}.env`, format: 'raw' as const },
					],
				}
			: {}),
		// A base backup reads the cluster's files; it never writes them.
		...(backups.pitr
			? { volumes: [`${volumeOf(POSTGRES_SERVICE)}:${POSTGRES_MOUNT}:ro`] }
			: {}),
		depends_on: { postgres: { condition: 'service_healthy' as const } },
		healthcheck: {
			test: ['CMD', 'node', RUNNER_PATH, 'health'],
			interval: '1m',
			timeout: '10s',
			retries: 3,
			start_period: '30s',
		},
	};
}

/**
 * What a base backup calls, by major: Postgres 15 renamed the functions,
 * and 14 — the first the role is used on — has the old ones.
 */
function baseBackupFunctions(version: PostgresVersion): string[] {
	return version >= 15
		? ['pg_backup_start(text, boolean)', 'pg_backup_stop(boolean)']
		: [
				'pg_start_backup(text, boolean, boolean)',
				'pg_stop_backup(boolean, boolean)',
			];
}

/**
 * The backups role, created and kept: able to sign in and read every
 * database, and nothing else. None when it signs in as the superuser.
 *
 * With `pitr` it may also take a base backup — start and stop one, and
 * switch to a new WAL segment — and read the archiver's statistics
 * (`pg_monitor`), which its health check reads. It still writes nothing.
 */
export function backupsRoleStatements(backups: StackBackups): Statement[] {
	if (!backups.readOnly) return [];
	const role = quoteIdentifier(backups.login.user);
	const password = `'${backups.login.password.replace(/'/g, "''")}'`;
	const pitr: Statement[] = backups.pitr
		? [
				{
					id: BACKUPS_SERVICE,
					describe: `role ${backups.login.user}: read the archiver's statistics`,
					create: `GRANT pg_monitor TO ${role}`,
				},
				...[...baseBackupFunctions(backups.version), 'pg_switch_wal()'].map(
					(fn): Statement => ({
						id: BACKUPS_SERVICE,
						describe: `role ${backups.login.user}: take a base backup — ${fn}`,
						create: `GRANT EXECUTE ON FUNCTION ${fn} TO ${role}`,
					}),
				),
			]
		: [];
	return [
		{
			id: BACKUPS_SERVICE,
			describe: `role ${backups.login.user}`,
			exists: {
				sql: 'SELECT 1 FROM pg_roles WHERE rolname = $1',
				values: [backups.login.user],
			},
			create: `CREATE ROLE ${role} LOGIN PASSWORD ${password}`,
		},
		{
			id: BACKUPS_SERVICE,
			describe: `role ${backups.login.user}: its password`,
			create: `ALTER ROLE ${role} WITH LOGIN PASSWORD ${password}`,
		},
		{
			id: BACKUPS_SERVICE,
			describe: `role ${backups.login.user}: read every database`,
			create: `GRANT pg_read_all_data TO ${role}`,
		},
		...pitr,
	];
}
