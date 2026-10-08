/**
 * Where to sign in to each local service, and as whom — what `gkm dev`
 * prints with its other addresses and `gkm dev:credentials` prints alone.
 *
 * Only the services a person opens or connects a client to: Postgres, the
 * MinIO console, Mailpit's inbox, Redis and its HTTP proxy, RabbitMQ's
 * console, the AWS emulator — and OpenObserve, where `gkm compose` runs it
 * for the local stage.
 */

import { CLUSTER_DATABASE } from './compose';
import type { LocalCredentials } from './localCredentials';
import type { PortAssignments } from './ports';

/** One service a person signs in to. */
export interface ServiceLogin {
	/** The container it is, e.g. `postgres`. */
	service: string;
	/** What it is, as printed. */
	label: string;
	/** Where to open or connect to it. */
	url: string;
	user?: string;
	password?: string;
	/** Anything else worth knowing, e.g. that it takes no login. */
	note?: string;
}

/** OpenObserve, where the local stage's compose stack runs it. */
export interface LocalLogs {
	url: string;
	/** The command that runs it. */
	via: string;
}

/** Each running service's address and login, in a stable order. */
export function serviceLogins(options: {
	containers: readonly string[];
	ports: PortAssignments;
	credentials: LocalCredentials;
	logs?: LocalLogs;
}): ServiceLogin[] {
	const { containers, ports, credentials } = options;
	const has = (container: string, key: string) =>
		containers.includes(container) && ports[key] !== undefined;
	const logins: ServiceLogin[] = [];

	if (has('postgres', 'postgres')) {
		const { user, password } = credentials.postgres;
		logins.push({
			service: 'postgres',
			label: 'Postgres',
			url: `postgres://${user}:${encodeURIComponent(password)}@localhost:${ports.postgres}/${CLUSTER_DATABASE}`,
			user,
			password,
		});
	}

	if (has('minio', 'minio-console')) {
		logins.push({
			service: 'minio',
			label: 'MinIO console',
			url: `http://localhost:${ports['minio-console']}`,
			...credentials.minio,
			...(ports.minio !== undefined
				? { note: `S3 API on http://localhost:${ports.minio}` }
				: {}),
		});
	}

	if (has('mailpit', 'mailpit-web')) {
		logins.push({
			service: 'mailpit',
			label: 'Mailpit inbox',
			url: `http://localhost:${ports['mailpit-web']}`,
			note: 'no login',
		});
	}

	if (has('redis', 'redis')) {
		logins.push({
			service: 'redis',
			label: 'Redis',
			url: `redis://:${encodeURIComponent(credentials.redis.password)}@localhost:${ports.redis}`,
			password: credentials.redis.password,
		});
	}

	if (has('redis-http', 'redis-http')) {
		logins.push({
			service: 'redis-http',
			label: 'Cache (HTTP)',
			url: `http://localhost:${ports['redis-http']}`,
			password: credentials.cacheToken,
			note: 'the password is its bearer token',
		});
	}

	if (has('rabbitmq', 'rabbitmq-management')) {
		logins.push({
			service: 'rabbitmq',
			label: 'RabbitMQ console',
			url: `http://localhost:${ports['rabbitmq-management']}`,
			...credentials.rabbitmq,
		});
	}

	if (has('localstack', 'localstack')) {
		logins.push({
			service: 'localstack',
			label: 'AWS emulator',
			url: `http://localhost:${ports.localstack}`,
			user: credentials.emulator.accessKeyId,
			password: credentials.emulator.secretAccessKey,
			note: 'access key id / secret access key',
		});
	}

	if (options.logs) {
		logins.push({
			service: 'openobserve',
			label: 'OpenObserve',
			url: options.logs.url,
			user: credentials.logs.email,
			password: credentials.logs.password,
			note: `when running: ${options.logs.via}`,
		});
	}

	return logins;
}

/** The lines `gkm dev` and `gkm dev:credentials` print, one per service. */
export function describeLogins(logins: readonly ServiceLogin[]): string[] {
	const width = Math.max(0, ...logins.map(({ label }) => label.length));
	return logins.flatMap((login) => {
		const head = `   ${login.label.padEnd(width)}  ${login.url}`;
		const signIn =
			login.user !== undefined && login.password !== undefined
				? `user ${login.user}, password ${login.password}`
				: login.password !== undefined
					? `password ${login.password}`
					: undefined;
		const detail = [signIn, login.note].filter(Boolean).join(' — ');
		return detail ? [head, `   ${' '.repeat(width)}  ${detail}`] : [head];
	});
}
