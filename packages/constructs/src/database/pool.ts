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
 * - **A span per query.** Through the global OpenTelemetry tracer, so a no-op
 *   without a provider. `pg` is bundled into a production entry, where no
 *   instrumentation can hook its module load — so the client is wrapped here,
 *   as the tags are. See {@link traceQueries}.
 * - **A way to close.** {@link closeDatabasePools} ends every pool opened, so a
 *   server shutting down releases its connections instead of holding them
 *   until the process dies.
 */

import { currentRequestContext } from '@geekmidas/services';
import {
	type Attributes,
	context,
	SpanKind,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';
import pg from 'pg';
import { onShutdown } from '../shutdown';

export interface DatabasePoolOptions {
	/** Tag queries run inside a request with what ran them. Default true. */
	queryTags?: boolean;
}

/** The longest statement text a query span carries. */
export const MAX_STATEMENT_LENGTH = 2048;

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
	const target = connectionAttributes(parsed);
	pool.on('connect', (client) => {
		// Tags first, so the span wraps them and records the statement as the
		// application wrote it rather than with the comment on the end.
		if (options.queryTags !== false) tagQueries(client);
		traceQueries(client, target);
	});

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

/** What every span of one pool says about where it connects. */
function connectionAttributes(url: URL): Attributes {
	const name = decodeURIComponent(url.pathname.slice(1));
	return {
		'db.system': 'postgresql',
		...(name && { 'db.name': name }),
		'server.address': url.hostname,
		'server.port': Number(url.port || 5432),
	};
}

const TRACER = '@geekmidas/constructs';

/** `select`, `insert`, … — the first keyword, or `with`'s main statement. */
const OPERATION = /^\s*(?:\/\*.*?\*\/\s*)?(\w+)/s;
/** The table a statement is about, when it names one where it usually does. */
const TABLE =
	/\b(?:from|into|update|join)\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i;

/**
 * What a statement does and to which table, parsed cheaply from its first
 * characters: `select "orders"`, `insert "public"."users"`. A statement the
 * patterns cannot read leaves `table` unset.
 */
export function describeStatement(text: string): {
	operation?: string;
	table?: string;
} {
	const head = text.length > 512 ? text.slice(0, 512) : text;
	const operation = OPERATION.exec(head)?.[1]?.toLowerCase();
	const table = TABLE.exec(head)?.[1]?.replace(/"/g, '');
	return {
		...(operation && { operation }),
		...(table && { table }),
	};
}

/**
 * A span around everything `client` runs — `<operation> <table>`, or
 * `db.query` when the statement does not say.
 *
 * The statement text goes on the span only for a parameterized query — values
 * passed separately, as Kysely always does — and truncated. Parameter values
 * never do. A bare string with no values could hold anything a caller
 * concatenated into it, so it gets no text at all.
 */
function traceQueries(client: pg.PoolClient, connection: Attributes): void {
	const query = client.query.bind(client) as (...args: unknown[]) => unknown;
	client.query = ((first: unknown, ...rest: unknown[]) => {
		const config =
			first && typeof first === 'object'
				? (first as { text?: unknown; values?: unknown })
				: undefined;
		const text =
			typeof first === 'string'
				? first
				: typeof config?.text === 'string'
					? config.text
					: undefined;
		const values = typeof first === 'string' ? rest[0] : config?.values;
		const { operation, table } = text ? describeStatement(text) : {};

		const span = trace
			.getTracer(TRACER)
			.startSpan(operation && table ? `${operation} ${table}` : 'db.query', {
				kind: SpanKind.CLIENT,
				attributes: {
					...connection,
					...(operation && { 'db.operation': operation }),
					...(table && { 'db.sql.table': table }),
					...(text &&
						Array.isArray(values) && {
							'db.statement':
								text.length > MAX_STATEMENT_LENGTH
									? text.slice(0, MAX_STATEMENT_LENGTH)
									: text,
						}),
				},
			});
		const end = (error?: unknown) => {
			if (error) {
				if (error instanceof Error) span.recordException(error);
				span.setStatus({ code: SpanStatusCode.ERROR });
			}
			span.end();
		};

		// A callback, as `pg`'s own callback form takes it.
		const last = rest[rest.length - 1];
		if (typeof last === 'function') {
			const args = [...rest];
			args[args.length - 1] = (error: unknown, ...result: unknown[]) => {
				end(error);
				return (last as (...a: unknown[]) => unknown)(error, ...result);
			};
			return context.with(trace.setSpan(context.active(), span), () =>
				query(first, ...args),
			);
		}

		let result: unknown;
		try {
			result = context.with(trace.setSpan(context.active(), span), () =>
				query(first, ...rest),
			);
		} catch (error) {
			end(error);
			throw error;
		}

		if (result && typeof (result as Promise<unknown>).then === 'function') {
			(result as Promise<unknown>).then(
				() => end(),
				(error) => end(error),
			);
		} else if (
			result &&
			typeof (result as { once?: unknown }).once === 'function'
		) {
			// A submittable — a cursor or a stream — ends when it says so.
			const emitter = result as {
				once(event: string, fn: (e?: unknown) => void): void;
			};
			emitter.once('end', () => end());
			emitter.once('error', (error) => end(error));
		} else {
			end();
		}
		return result;
	}) as typeof client.query;
}
