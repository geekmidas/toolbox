import type { SelectQueryBuilder } from 'kysely';
import {
	Direction,
	decodeCursor,
	encodeCursor,
	type PaginationResult,
} from '../pagination';

export { Direction, decodeCursor, encodeCursor, type PaginationResult };

/**
 * Options for paginated search.
 */
export interface PaginatedSearchOptions<
	TRow,
	TMapRow extends (row: TRow) => unknown = (row: TRow) => TRow,
> {
	/** The base Kysely query to paginate */
	query: SelectQueryBuilder<any, any, TRow>;
	/** Cursor value for pagination (value of cursorField from previous page) */
	cursor?: string;
	/** Maximum number of items per page (default: 20) */
	limit?: number;
	/** Function to transform each row to the output format (default: identity) */
	mapRow?: TMapRow;
	/** Field to use for cursor pagination (default: 'id') */
	cursorField?: string;
	/** Sort direction for cursor field (default: Direction.Asc) */
	cursorDirection?: Direction;
}

/**
 * Generic paginated search function that handles:
 * - Total count calculation
 * - Cursor-based pagination
 * - Fetching one extra row to determine hasMore
 * - Mapping rows to output format
 *
 * @example
 * ```typescript
 * // With mapRow
 * const result = await paginatedSearch({
 *   query: db.selectFrom('users').selectAll(),
 *   limit: 20,
 *   mapRow: (row) => ({ id: row.id, name: row.name }),
 * });
 *
 * // Without mapRow — items are the raw row type
 * const result = await paginatedSearch({
 *   query: db.selectFrom('users').selectAll(),
 *   limit: 20,
 * });
 * ```
 */
export async function paginatedSearch<
	TRow extends Record<string, unknown>,
	TMapRow extends (row: TRow) => unknown = (row: TRow) => TRow,
>({
	query,
	cursor,
	limit = 20,
	mapRow,
	cursorField = 'id',
	cursorDirection = Direction.Asc,
}: PaginatedSearchOptions<TRow, TMapRow>): Promise<
	PaginationResult<Awaited<ReturnType<TMapRow>>>
> {
	// Get total count (without cursor)
	const countResult = await query
		.clearSelect()
		.clearOrderBy()
		.select((eb) => eb.fn.countAll().as('count'))
		.executeTakeFirstOrThrow();

	const count = countResult.count;

	// Apply cursor if provided
	let paginatedQuery = query;
	if (cursor) {
		const operator = cursorDirection === Direction.Asc ? '>' : '<';
		paginatedQuery = paginatedQuery.where(
			cursorField as any,
			operator,
			cursor,
		) as typeof query;
	}

	// Fetch one extra to determine if there are more results
	const data = await paginatedQuery
		.orderBy(cursorField as any, cursorDirection)
		.limit(limit + 1)
		.execute();

	const hasMore = data.length > limit;
	const rows = hasMore ? data.slice(0, limit) : data;
	const lastRow = rows[rows.length - 1];
	const nextCursor =
		hasMore && lastRow ? String(lastRow[cursorField]) : undefined;

	const mapper = mapRow ?? ((row: TRow) => row);
	const items = (await Promise.all(rows.map(mapper))) as Awaited<
		ReturnType<TMapRow>
	>[];

	return {
		items,
		pagination: {
			total: Number(count),
			hasMore,
			cursor: nextCursor,
		},
	};
}
