/**
 * Bringing a container that already has data in line with the workspace's
 * generated logins.
 *
 * Postgres and RabbitMQ read their login from the environment once, when the
 * volume is first initialised; a volume an older gkm made was initialised
 * with the old fixed one, and a changed environment alone would lock the
 * developer out of their own data. So after the containers are up, each one
 * is asked whether the generated login opens it, and if not:
 *
 * - **Postgres**: signed in to with the old login, the generated superuser is
 *   created (or given its password), and the old one stops logging in. Where
 *   no login is accepted — another checkout of the same project rotated it —
 *   the password is set from inside the container, which trusts its own
 *   socket.
 * - **MinIO** reads its root login on every start, so recreating the
 *   container rotated it already. If the old login is still the one it takes —
 *   a project's own `docker-compose.yml` pins it — that is kept, with a note.
 * - **RabbitMQ**: the user is added, or given its password, with `rabbitmqctl`
 *   inside the container.
 *
 * Nothing is deleted: no volume, no database, no bucket.
 */

import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { Client } from 'pg';
import { GkmError } from '../errors';
import { CLUSTER_DATABASE } from './compose';
import type { LocalCredentials, Login } from './localCredentials';

/**
 * The login every local container was brought up with before logins were
 * generated. Kept only to recognise — and rotate away from — a volume made
 * then.
 */
export const LEGACY_LOCAL_LOGIN: Login = Object.freeze({
	user: 'geekmidas',
	password: 'geekmidas',
});

/** Runs a command inside a running compose service. */
export type ServiceExec = (
	service: string,
	argv: readonly string[],
) => Promise<{ ok: boolean; output: string }>;

/** What checking one service's login found and did. */
export interface LoginOutcome {
	service: 'postgres' | 'minio' | 'rabbitmq';
	/**
	 * `current` — the generated login opened it; `rotated` — an older login
	 * did, and the service now takes the generated one; `kept` — an older
	 * login did and could not be rotated, so it is what is used.
	 */
	status: 'current' | 'rotated' | 'kept';
	/** The login the service takes now. */
	login: Login;
	/** A line for the developer, where anything changed. */
	notice?: string;
}

/** No login this workspace knows opens its Postgres. */
export class PostgresLoginRefused extends GkmError {
	constructor(
		readonly port: number,
		readonly user: string,
	) {
		super(
			`The Postgres on port ${port} accepts neither '${user}' with this workspace's generated password nor the login older gkm versions used, and could not be reset from inside its container. ` +
				"If it is not this project's container, stop whatever holds the port. If it is, removing its volume starts it over with the generated login — and deletes its data: docker compose -f docker-compose.constructs.yml down -v",
		);
		this.name = 'PostgresLoginRefused';
	}
}

/** No login this workspace knows opens its MinIO. */
export class MinioLoginRefused extends GkmError {
	constructor(
		readonly port: number,
		readonly user: string,
	) {
		super(
			`The MinIO on port ${port} accepts neither '${user}' with this workspace's generated password nor the login older gkm versions used. ` +
				'If your docker-compose.yml sets MINIO_ROOT_USER or MINIO_ROOT_PASSWORD, remove them so the generated login applies.',
		);
		this.name = 'MinioLoginRefused';
	}
}

/** Whether `login` opens the Postgres on `port`, as a connected client. */
async function connect(port: number, login: Login): Promise<Client | null> {
	const client = new Client({
		host: 'localhost',
		port,
		user: login.user,
		password: login.password,
		database: CLUSTER_DATABASE,
	});
	try {
		await client.connect();
		return client;
	} catch (error) {
		await client.end().catch(() => {});
		// 28P01: wrong password. 28000: no such role, or no pg_hba entry.
		// 3D000: no such database — a cluster whose default database was
		// named after an older superuser still answers for `postgres`, so
		// this is only a login that is not ours.
		const code = (error as { code?: string }).code;
		if (code === '28P01' || code === '28000' || code === '3D000') return null;
		throw error;
	}
}

/** Quote a string literal for DDL that cannot take parameters. */
function literal(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function ident(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/** The SQL that makes `login` a superuser with its password, new or not. */
function superuserSql(login: Login): string {
	return (
		`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(login.user)}) ` +
		`THEN ALTER ROLE ${ident(login.user)} WITH SUPERUSER LOGIN PASSWORD ${literal(login.password)}; ` +
		`ELSE CREATE ROLE ${ident(login.user)} WITH SUPERUSER LOGIN PASSWORD ${literal(login.password)}; ` +
		'END IF; END $$'
	);
}

/**
 * Make the Postgres on `port` take `login`, rotating it from an older one
 * where that is what it takes.
 */
export async function ensurePostgresLogin(options: {
	port: number;
	login: Login;
	/** Older logins it may still take, most likely first. */
	legacy: readonly Login[];
	/** Inside the container, where its socket trusts any role. */
	exec?: ServiceExec;
}): Promise<LoginOutcome> {
	const { port, login, legacy } = options;

	const current = await connect(port, login);
	if (current) {
		await current.end();
		return { service: 'postgres', status: 'current', login };
	}

	for (const old of legacy) {
		const client = await connect(port, old);
		if (!client) continue;
		try {
			await client.query(superuserSql(login));
		} catch {
			// The old login is not allowed to make a superuser: keep using it.
			await client.end();
			return {
				service: 'postgres',
				status: 'kept',
				login: old,
				notice: `⚠️  Postgres still signs in as '${old.user}' with the old fixed password: it could not be rotated. To start over with a generated one, remove its volume (this deletes its data): docker compose -f docker-compose.constructs.yml down -v`,
			};
		}
		await client.end();
		await retire(port, login, old);
		return {
			service: 'postgres',
			status: 'rotated',
			login,
			notice: `🔑 Postgres moved from the old fixed login to a generated one ('${login.user}'); its data is unchanged. See it with: gkm dev:credentials`,
		};
	}

	// Nothing we know opens it over TCP. Its socket inside the container
	// trusts any role that exists, which one of these is.
	if (options.exec) {
		for (const user of [login.user, ...legacy.map((l) => l.user)]) {
			const result = await options.exec('postgres', [
				'psql',
				'-v',
				'ON_ERROR_STOP=1',
				'-U',
				user,
				'-d',
				CLUSTER_DATABASE,
				'-c',
				superuserSql(login),
			]);
			if (!result.ok) continue;
			const client = await connect(port, login);
			if (!client) continue;
			await client.end();
			for (const old of legacy) await retire(port, login, old);
			return {
				service: 'postgres',
				status: 'rotated',
				login,
				notice: `🔑 Postgres's login was reset to this workspace's generated one ('${login.user}'); its data is unchanged.`,
			};
		}
	}

	throw new PostgresLoginRefused(port, login.user);
}

/** Stop an older login from opening the cluster, now another does. */
async function retire(port: number, login: Login, old: Login): Promise<void> {
	if (old.user === login.user) return;
	const client = await connect(port, login);
	if (!client) return;
	try {
		const exists = await client.query(
			'SELECT 1 FROM pg_roles WHERE rolname = $1',
			[old.user],
		);
		if (exists.rowCount) {
			await client.query(
				`ALTER ROLE ${ident(old.user)} WITH NOLOGIN PASSWORD NULL`,
			);
		}
	} finally {
		await client.end();
	}
}

/** Whether `login` signs in to the MinIO on `port`. */
export async function minioAccepts(
	port: number,
	login: Login,
): Promise<boolean> {
	const s3 = new S3Client({
		region: 'us-east-1',
		endpoint: `http://localhost:${port}`,
		forcePathStyle: true,
		credentials: { accessKeyId: login.user, secretAccessKey: login.password },
		maxAttempts: 1,
	});
	try {
		await s3.send(new ListBucketsCommand({}));
		return true;
	} catch (error) {
		const name = (error as { name?: string }).name ?? '';
		if (
			name === 'InvalidAccessKeyId' ||
			name === 'SignatureDoesNotMatch' ||
			name === 'AccessDenied'
		) {
			return false;
		}
		throw error;
	} finally {
		s3.destroy();
	}
}

/**
 * Check the MinIO on `port` takes `login`. It reads its root login on every
 * start, so a recreated container already does — unless something pins an
 * older one, which is then kept.
 */
export async function ensureMinioLogin(options: {
	port: number;
	login: Login;
	legacy: readonly Login[];
}): Promise<LoginOutcome> {
	const { port, login, legacy } = options;
	if (await minioAccepts(port, login)) {
		return { service: 'minio', status: 'current', login };
	}
	for (const old of legacy) {
		if (await minioAccepts(port, old)) {
			return {
				service: 'minio',
				status: 'kept',
				login: old,
				notice: `⚠️  MinIO still signs in as '${old.user}' with the old fixed password: something — usually your docker-compose.yml's MINIO_ROOT_USER/MINIO_ROOT_PASSWORD — pins it. Remove that to use the generated login.`,
			};
		}
	}
	throw new MinioLoginRefused(port, login.user);
}

/**
 * Make the RabbitMQ in the project's container take `login`, with
 * `rabbitmqctl` inside it — which needs no password.
 */
export async function ensureRabbitmqLogin(options: {
	login: Login;
	legacy: readonly Login[];
	exec: ServiceExec;
}): Promise<LoginOutcome> {
	const { login, legacy, exec } = options;
	const ctl = (...args: string[]) => exec('rabbitmq', ['rabbitmqctl', ...args]);

	if ((await ctl('authenticate_user', login.user, login.password)).ok) {
		return { service: 'rabbitmq', status: 'current', login };
	}

	if (!(await ctl('add_user', login.user, login.password)).ok) {
		await ctl('change_password', login.user, login.password);
	}
	await ctl('set_user_tags', login.user, 'administrator');
	await ctl('set_permissions', '-p', '/', login.user, '.*', '.*', '.*');
	for (const old of legacy) {
		if (old.user !== login.user) await ctl('delete_user', old.user);
	}
	return {
		service: 'rabbitmq',
		status: 'rotated',
		login,
		notice: `🔑 RabbitMQ moved from the old fixed login to a generated one ('${login.user}'); its queues are unchanged.`,
	};
}

/** Every container's login, checked — and what is used from now on. */
export interface LoginsResult {
	credentials: LocalCredentials;
	outcomes: LoginOutcome[];
}

/**
 * Check the login of each running container that keeps one, and the
 * credentials to use from here: the generated ones, or an older login a
 * service could not be moved off.
 */
export async function ensureLogins(options: {
	credentials: LocalCredentials;
	containers: readonly string[];
	ports: { postgres?: number; minio?: number };
	exec?: ServiceExec;
}): Promise<LoginsResult> {
	const { containers, ports, exec } = options;
	let credentials = options.credentials;
	const outcomes: LoginOutcome[] = [];
	const legacy = [LEGACY_LOCAL_LOGIN];

	if (containers.includes('postgres') && ports.postgres !== undefined) {
		const outcome = await ensurePostgresLogin({
			port: ports.postgres,
			login: credentials.postgres,
			legacy,
			...(exec ? { exec } : {}),
		});
		outcomes.push(outcome);
		credentials = { ...credentials, postgres: outcome.login };
	}

	if (containers.includes('minio') && ports.minio !== undefined) {
		const outcome = await ensureMinioLogin({
			port: ports.minio,
			login: credentials.minio,
			legacy,
		});
		outcomes.push(outcome);
		credentials = { ...credentials, minio: outcome.login };
	}

	if (containers.includes('rabbitmq') && exec) {
		outcomes.push(
			await ensureRabbitmqLogin({
				login: credentials.rabbitmq,
				legacy,
				exec,
			}),
		);
	}

	return { credentials, outcomes };
}
