/**
 * The `pg` pools a database construct opens, and what every one of them gets:
 *
 * - **A name.** `application_name` is what `pg_stat_activity` shows beside a
 *   connection. Without one, a database at `max_connections` cannot say who
 *   holds them. It is a *fallback*, so `PGAPPNAME` or `?application_name=` in
 *   the URL still win.
 * - **Tagged queries.** Inside a request, each query ends in a comment naming
 *   what ran it — `/*operation='POST /orders',request_id='…'*\/` — in the
 *   sqlcommenter form. It shows in `pg_stat_activity.query`, in the server's
 *   slow-query and `auto_explain` logs, and costs no round trip;
 *   `pg_stat_statements` ignores comments, so its grouping is unchanged.
 * - **A listener for idle-client errors.** When the server ends an idle
 *   connection (`idle_session_timeout`, a failover, an admin), the pool emits
 *   `'error'`. With no listener that is an uncaught exception that kills the
 *   process — for a client the pool has already discarded.
 * - **A way to close.** {@link closeDatabasePools} ends every pool opened, so a
 *   server shutting down releases its connections instead of holding them
 *   until the process dies.
 */

import { currentRequestContext } from '@geekmidas/services';
import pg from 'pg';
import { onShutdown } from '../shutdown';

export interface DatabasePoolOptions {
	/** Tag queries run inside a request with what ran them. Default true. */
	queryTags?: boolean;
}

/** Every pool opened and not yet closed, so a shutdown can end them all. */
const open = new Set<pg.Pool>();
onShutdown(() => closeDatabasePools());

/**
 * A pool for one URL, with its schema actually on the search path.
 *
 * `?search_path=` is not a libpq parameter — a URL carrying it connects
 * happily and then resolves every unqualified name against `public`, which is
 * how a schema tenant silently writes its tables into the database it was
 * separated from. Postgres takes it as a startup option instead, so the URL
 * keeps the readable form the target derives and this turns it into the thing
 * the server understands.
 */
export function openPool(
	url: string,
	options: DatabasePoolOptions = {},
): pg.Pool {
	const parsed = new URL(url);
	const searchPath = parsed.searchParams.get('search_path');
	parsed.searchParams.delete('search_path');

	const pool = new pg.Pool({
		connectionString: parsed.toString(),
		...(searchPath ? { options: `-c search_path=${searchPath}` } : {}),
		fallback_application_name: applicationName(),
	});

	pool.on('error', (error) => {
		const logger = currentRequestContext()?.logger;
		if (logger) logger.warn({ err: error }, 'Idle database connection lost');
		else console.warn('Idle database connection lost:', error.message);
	});
	if (options.queryTags !== false) {
		pool.on('connect', (client) => tagQueries(client));
	}

	open.add(pool);
	const end = pool.end.bind(pool);
	pool.end = (async () => {
		open.delete(pool);
		await end();
	}) as typeof pool.end;

	return pool;
}

/**
 * End every pool opened, waiting for checked-out connections to come back.
 * For a server's shutdown, after it has stopped taking requests.
 */
export async function closeDatabasePools(): Promise<void> {
	await Promise.all([...open].map((pool) => pool.end()));
}

/**
 * Who this process is, as Postgres will show it: the Lambda function, else the
 * app — `GKM_APP_NAME` where an entry sets it, `gkm dev`'s app tag otherwise.
 * Postgres keeps 63 bytes of it.
 */
export function applicationName(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	return (
		env.AWS_LAMBDA_FUNCTION_NAME ||
		env.GKM_APP_NAME ||
		env.GKM_DEV_APP?.split('#').pop() ||
		undefined
	);
}

/**
 * The comment that says what ran a query, or '' outside a request.
 *
 * Values keep only characters that cannot end a comment or a quoted value —
 * `*` and `'` among those dropped — so a route cannot inject SQL through it.
 */
export function queryTag(): string {
	const request = currentRequestContext();
	if (!request) return '';

	const tags = [
		['operation', request.operation],
		['request_id', request.requestId],
	].filter((tag): tag is [string, string] => Boolean(tag[1]));
	if (tags.length === 0) return '';

	const clean = (value: string) => value.replace(/[^\w ./:{}@-]/g, '');
	return ` /*${tags.map(([key, value]) => `${key}='${clean(value)}'`).join(',')}*/`;
}

/**
 * Append {@link queryTag} to everything `client` runs: a SQL string — what
 * Kysely sends — or a query object such as a cursor's.
 */
function tagQueries(client: pg.PoolClient): void {
	const query = client.query.bind(client) as (...args: unknown[]) => unknown;
	client.query = ((first: unknown, ...rest: unknown[]) => {
		const tag = queryTag();
		if (tag && typeof first === 'string') return query(first + tag, ...rest);
		if (
			tag &&
			first &&
			typeof first === 'object' &&
			typeof (first as { text?: unknown }).text === 'string'
		) {
			const config = first as { text: string };
			config.text += tag;
		}
		return query(first, ...rest);
	}) as typeof client.query;
}
