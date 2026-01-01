import type { SelectQueryBuilder } from 'kysely';

/**
 * Sort direction for cursor-based pagination.
 */
export enum Direction {
  Asc = 'asc',
  Desc = 'desc',
}

/**
 * Result of a paginated query.
 */
export interface PaginationResult<TItem> {
  items: TItem[];
  pagination: {
    total: number;
    hasMore: boolean;
    cursor?: string;
  };
}

/**
 * Options for paginated search.
 */
export interface PaginatedSearchOptions<
  TRow,
  TMapRow extends (row: TRow) => unknown,
> {
  /** The base Kysely query to paginate */
  query: SelectQueryBuilder<any, any, TRow>;
  /** Cursor value for pagination (value of cursorField from previous page) */
  cursor?: string;
  /** Maximum number of items per page (default: 20) */
  limit?: number;
  /** Function to transform each row to the output format */
  mapRow: TMapRow;
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
 * const result = await paginatedSearch({
 *   query: db.selectFrom('users').selectAll(),
 *   cursor: previousCursor,
 *   limit: 20,
 *   mapRow: (row) => ({ id: row.id, name: row.name }),
 *   cursorField: 'id',
 *   cursorDirection: Direction.Asc,
 * });
 * ```
 */
export async function paginatedSearch<
  TRow extends Record<string, unknown>,
  TMapRow extends (row: TRow) => unknown,
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

  const items = (await Promise.all(rows.map(mapRow))) as Awaited<
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

/**
 * Encode a cursor value for safe URL transmission.
 * Supports various types: string, number, Date, etc.
 */
export function encodeCursor(value: unknown): string {
  const payload = {
    v: value instanceof Date ? value.toISOString() : value,
    t: value instanceof Date ? 'date' : typeof value,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a cursor string back to its original value.
 */
export function decodeCursor(cursor: string): unknown {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const payload = JSON.parse(json);

    if (payload.t === 'date') {
      return new Date(payload.v);
    }

    return payload.v;
  } catch {
    throw new Error('Invalid cursor format');
  }
}
