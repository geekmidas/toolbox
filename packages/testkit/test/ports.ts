/**
 * Host ports the repo's compose stack publishes on.
 *
 * `docker-compose.yml` makes every host port overridable, because a developer
 * with another project's Postgres on 5432 or Redis on 6379 otherwise cannot run
 * this stack at all — and a single conflict does not fail one suite, it aborts
 * collection and reports *no tests*, which looks identical to a suite that
 * passed.
 *
 * These read the same variables the compose file does, so a suite connects to
 * wherever the container was actually published rather than to where it would
 * have been by default.
 */

/**
 * Every host port `docker-compose.yml` publishes, by the variable that moves
 * it, with the default it falls back to. One table, so a port Docker reports
 * as taken can be traced back to the variable a developer has to set.
 */
export const HOST_PORT_DEFAULTS = {
	POSTGRES_HOST_PORT: 5432,
	REDIS_HOST_PORT: 6379,
	SRH_HOST_PORT: 8079,
	MINIO_API_HOST_PORT: 9000,
	MINIO_CONSOLE_HOST_PORT: 9001,
	RABBITMQ_HOST_PORT: 5672,
	RABBITMQ_MGMT_HOST_PORT: 15672,
	LOCALSTACK_HOST_PORT: 4566,
	MAILPIT_SMTP_HOST_PORT: 1025,
	MAILPIT_HOST_PORT: 8025,
} as const;

export type HostPortVariable = keyof typeof HOST_PORT_DEFAULTS;

/** The host port a variable currently resolves to: its override, or its default. */
export function hostPort(variable: HostPortVariable): number {
	return port(variable, HOST_PORT_DEFAULTS[variable]);
}

function port(variable: string, fallback: number): number {
	const value = process.env[variable];
	const parsed = value ? Number(value) : Number.NaN;

	return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read from `POSTGRES_HOST_PORT`, not the older `GKM_TEST_PG_PORT`.
 *
 * Compose interpolation has no nested defaults — `${A:-${B:-5432}}` does not
 * fall back, it publishes *no port at all*, which looks like a database that is
 * running and unreachable. Supporting both names meant writing exactly that, so
 * there is one name, and it matches the five beside it.
 */
export const POSTGRES_PORT = hostPort('POSTGRES_HOST_PORT');
export const REDIS_PORT = hostPort('REDIS_HOST_PORT');
/** The HTTP proxy the Upstash client speaks to, not Redis itself. */
export const SRH_PORT = hostPort('SRH_HOST_PORT');
export const SRH_URL = `http://localhost:${SRH_PORT}`;
export const MINIO_PORT = hostPort('MINIO_API_HOST_PORT');
export const RABBITMQ_PORT = hostPort('RABBITMQ_HOST_PORT');
/** Credentials and host, for building `amqp://` and `rabbitmq://` strings. */
export const RABBITMQ_AUTHORITY = `geekmidas:geekmidas@localhost:${RABBITMQ_PORT}`;
export const RABBITMQ_URL = `amqp://${RABBITMQ_AUTHORITY}`;
export const LOCALSTACK_PORT = hostPort('LOCALSTACK_HOST_PORT');
export const LOCALSTACK_URL = `http://localhost:${LOCALSTACK_PORT}`;
export const MAILPIT_SMTP_PORT = hostPort('MAILPIT_SMTP_HOST_PORT');
export const MAILPIT_PORT = hostPort('MAILPIT_HOST_PORT');
export const MAILPIT_URL = `http://localhost:${MAILPIT_PORT}`;
