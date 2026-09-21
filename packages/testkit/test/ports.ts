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

function port(variable: string, fallback: number): number {
	const value = process.env[variable];
	const parsed = value ? Number(value) : Number.NaN;

	return Number.isFinite(parsed) ? parsed : fallback;
}

export const POSTGRES_PORT = port(
	process.env.POSTGRES_HOST_PORT ? 'POSTGRES_HOST_PORT' : 'GKM_TEST_PG_PORT',
	5432,
);
export const REDIS_PORT = port('REDIS_HOST_PORT', 6379);
/** The HTTP proxy the Upstash client speaks to, not Redis itself. */
export const SRH_PORT = port('SRH_HOST_PORT', 8079);
export const SRH_URL = `http://localhost:${SRH_PORT}`;
export const MINIO_PORT = port('MINIO_API_HOST_PORT', 9000);
export const RABBITMQ_PORT = port('RABBITMQ_HOST_PORT', 5672);
export const LOCALSTACK_PORT = port('LOCALSTACK_HOST_PORT', 4566);
export const LOCALSTACK_URL = `http://localhost:${LOCALSTACK_PORT}`;
