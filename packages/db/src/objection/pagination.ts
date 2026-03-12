import type { Model, QueryBuilder } from 'objection';
import {
	Direction,
	decodeCursor,
	encodeCursor,
	type PaginationResult,
} from '../pagination';

export { Direction, decodeCursor, encodeCursor, type PaginationResult };

/**
 * Options for paginated search with Objection.js models.
 */
export interface ObjectionPaginatedSearchOptions<
	TModel extends Model,
	TMapRow extends (row: TModel) => unknown = (row: TModel) => TModel,
> {
	/** The Objection QueryBuilder to paginate (e.g. User.query(trx).where(...)) */
	query: QueryBuilder<TModel>;
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
 * Cursor-based paginated search for Objection.js models.
 *
 * Accepts a pre-built QueryBuilder so callers can apply filters,
 * eager loading, and scopes before pagination is layered on top.
 *
 * @example
 * ```typescript
 * const result = await paginatedSearch({
 *   query: User.query(trx).where('orgId', orgId).withGraphFetched('roles'),
 *   cursor: previousCursor,
 *   limit: 20,
 *   cursorField: 'createdAt',
 *   cursorDirection: Direction.Desc,
 * });
 * ```
 */
export async function paginatedSearch<
	TModel extends Model,
	TMapRow extends (row: TModel) => unknown = (row: TModel) => TModel,
>({
	query,
	cursor,
	limit = 20,
	mapRow,
	cursorField = 'id',
	cursorDirection = Direction.Asc,
}: ObjectionPaginatedSearchOptions<TModel, TMapRow>): Promise<
	PaginationResult<Awaited<ReturnType<TMapRow>>>
> {
	// Get total count (without cursor filtering)
	const total = await query.resultSize();

	// Apply cursor if provided
	let paginatedQuery = query.clone();
	if (cursor) {
		const operator = cursorDirection === Direction.Asc ? '>' : '<';
		paginatedQuery = paginatedQuery.where(cursorField, operator, cursor);
	}

	// Fetch one extra to determine if there are more results
	const data = await paginatedQuery
		.orderBy(cursorField, cursorDirection)
		.limit(limit + 1);

	const hasMore = data.length > limit;
	const rows = hasMore ? data.slice(0, limit) : data;
	const lastRow = rows[rows.length - 1];
	const nextCursor =
		hasMore && lastRow
			? String((lastRow as Record<string, unknown>)[cursorField])
			: undefined;

	const mapper = mapRow ?? ((row: TModel) => row);
	const items = (await Promise.all(rows.map(mapper))) as Awaited<
		ReturnType<TMapRow>
	>[];

	return {
		items,
		pagination: {
			total,
			hasMore,
			cursor: nextCursor,
		},
	};
}
