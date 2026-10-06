import { Direction, InvalidCursor } from '../pagination';
import { DataBrowser } from './DataBrowser';
import {
	ColumnNotFound,
	TableNotFound,
	UnsupportedFilterOperator,
} from './errors';
import {
	type DataBrowserOptions,
	type FilterCondition,
	FilterOperator,
	type SortConfig,
} from './types';

export interface IntrospectionHandlerOptions<DB = unknown>
	extends DataBrowserOptions<DB> {
	/**
	 * The path the handler is mounted under, e.g. `/__gkm/db`. Stripped from
	 * each request's path before routing, so the handler can be mounted
	 * anywhere without a router of its own.
	 */
	basePath?: string;
}

/** A fetch-style handler: a web `Request` in, a JSON `Response` out. */
export type IntrospectionHandler = (request: Request) => Promise<Response>;

const OPERATORS = new Set<string>(Object.values(FilterOperator));

/**
 * A read-only JSON API over a Postgres database's structure and rows.
 *
 * A plain `(Request) => Promise<Response>` rather than a router, so it mounts
 * in anything that speaks web `Request`s — Hono, Bun, Deno, a Node adapter —
 * and `@geekmidas/db` takes on no HTTP framework to provide it.
 *
 * | Route                         | Returns                                         |
 * | ----------------------------- | ----------------------------------------------- |
 * | `GET /schemas`                | `{ schemas, browsable }`                        |
 * | `GET /tables?schema=&refresh=`| `{ tables }` with columns and foreign keys      |
 * | `GET /tables/:name?schema=`   | one table                                       |
 * | `GET /tables/:name/rows`      | a page of rows: `{ rows, hasMore, nextCursor }` |
 *
 * Rows take `pageSize` (≤ 100), `cursor`, `sort=col:asc,col2:desc` and filters
 * as `filter[column][operator]=value` — `in`/`nin` take a comma-separated
 * list, `is_null`/`is_not_null` take no value.
 *
 * It exposes every row of every browsable table to whoever can reach it. Mount
 * it only where that is the developer: `gkm dev` serves it at `/__gkm/db` and
 * nothing in a production build does.
 *
 * @example
 * ```typescript
 * const handler = createIntrospectionHandler({ db, basePath: '/__gkm/db' });
 * app.all('/__gkm/db/*', (c) => handler(c.req.raw));
 * ```
 */
export function createIntrospectionHandler<DB>(
	options: IntrospectionHandlerOptions<DB>,
): IntrospectionHandler {
	const browser = new DataBrowser(options);
	const basePath = (options.basePath ?? '').replace(/\/+$/, '');

	return async (request) => {
		if (request.method !== 'GET') {
			return json(
				{
					error: 'MethodNotAllowed',
					message: 'The database API is read-only; only GET is served.',
				},
				405,
				{ allow: 'GET' },
			);
		}

		const url = new URL(request.url);
		const path = url.pathname.startsWith(basePath)
			? url.pathname.slice(basePath.length)
			: url.pathname;
		const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
		const schema = url.searchParams.get('schema') ?? undefined;

		try {
			if (segments.length === 1 && segments[0] === 'schemas') {
				return json({
					schemas: await browser.listSchemas(),
					browsable: browser.schemas,
				});
			}

			if (segments.length === 1 && segments[0] === 'tables') {
				const refresh = url.searchParams.get('refresh') === 'true';
				const { tables, updatedAt } = await browser.getSchema(refresh);
				return json({
					tables: schema ? tables.filter((t) => t.schema === schema) : tables,
					updatedAt,
				});
			}

			if (segments[0] === 'tables' && segments[1] && segments.length === 2) {
				const table = await browser.getTableInfo(segments[1], schema);
				if (!table) {
					throw new TableNotFound(
						segments[1],
						schema ?? browser.schemas[0] ?? 'public',
					);
				}
				return json(table);
			}

			if (
				segments[0] === 'tables' &&
				segments[1] &&
				segments[2] === 'rows' &&
				segments.length === 3
			) {
				const pageSize = Number.parseInt(
					url.searchParams.get('pageSize') ?? '',
					10,
				);
				const filters = parseFilters(url.searchParams);
				const sort = parseSort(url.searchParams.get('sort'));

				return json(
					await browser.query({
						table: segments[1],
						schema,
						pageSize: Number.isNaN(pageSize) ? undefined : pageSize,
						cursor: url.searchParams.get('cursor') || undefined,
						filters: filters.length > 0 ? filters : undefined,
						sort: sort.length > 0 ? sort : undefined,
					}),
				);
			}

			return json(
				{
					error: 'NotFound',
					message: `No database route at '${path || '/'}'. Routes: /schemas, /tables, /tables/:name, /tables/:name/rows.`,
				},
				404,
			);
		} catch (error) {
			const status = statusFor(error);
			if (status === undefined) throw error;
			return json(
				{ error: (error as Error).name, message: (error as Error).message },
				status,
			);
		}
	};
}

/** The caller's mistakes, answered; anything else is the server's and thrown. */
function statusFor(error: unknown): number | undefined {
	if (error instanceof TableNotFound) return 404;
	if (
		error instanceof ColumnNotFound ||
		error instanceof UnsupportedFilterOperator ||
		error instanceof InvalidCursor
	) {
		return 400;
	}
	return undefined;
}

/**
 * `filter[column][operator]=value`. An unknown operator is ignored rather than
 * rejected, as a misspelt one in a hand-typed URL is easier to see in the
 * results than to debug from an error.
 */
function parseFilters(params: URLSearchParams): FilterCondition[] {
	const filters: FilterCondition[] = [];

	for (const [key, value] of params) {
		const match = key.match(/^filter\[(\w+)\]\[(\w+)\]$/);
		const column = match?.[1];
		const operator = match?.[2];
		if (!column || !operator || !OPERATORS.has(operator)) continue;

		const op = operator as FilterOperator;
		if (op === FilterOperator.In || op === FilterOperator.Nin) {
			filters.push({ column, operator: op, value: value.split(',') });
		} else if (
			op === FilterOperator.IsNull ||
			op === FilterOperator.IsNotNull
		) {
			filters.push({ column, operator: op });
		} else {
			filters.push({ column, operator: op, value: parseScalar(value) });
		}
	}

	return filters;
}

function parseScalar(value: string): unknown {
	if (value === 'true') return true;
	if (value === 'false') return false;
	if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
	return value;
}

/** `sort=name:asc,created_at:desc`; a column with no direction is ascending. */
function parseSort(param: string | null): SortConfig[] {
	if (!param) return [];

	return param.split(',').flatMap((part) => {
		const [column, direction] = part.split(':');
		if (!column) return [];
		return [
			{
				column,
				direction: direction === 'desc' ? Direction.Desc : Direction.Asc,
			},
		];
	});
}

function json(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	// A row can hold a bigint when the pg client is configured to parse int8,
	// and JSON.stringify throws on one.
	const text = JSON.stringify(body, (_key, value) =>
		typeof value === 'bigint' ? value.toString() : value,
	);
	return new Response(text, {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
	});
}
