import type { SelectQueryBuilder } from 'kysely';
import {
  type ColumnInfo,
  Direction,
  type FilterCondition,
  FilterOperator,
  type SortConfig,
  type TableInfo,
} from '../types';

/**
 * Validates that a filter is applicable to the given column.
 */
export function validateFilter(
  filter: FilterCondition,
  columnInfo: ColumnInfo,
): { valid: boolean; error?: string } {
  // Validate operator compatibility with column type
  const typeCompatibility: Record<string, FilterOperator[]> = {
    string: [
      FilterOperator.Eq,
      FilterOperator.Neq,
      FilterOperator.Like,
      FilterOperator.Ilike,
      FilterOperator.In,
      FilterOperator.Nin,
      FilterOperator.IsNull,
      FilterOperator.IsNotNull,
    ],
    number: [
      FilterOperator.Eq,
      FilterOperator.Neq,
      FilterOperator.Gt,
      FilterOperator.Gte,
      FilterOperator.Lt,
      FilterOperator.Lte,
      FilterOperator.In,
      FilterOperator.Nin,
      FilterOperator.IsNull,
      FilterOperator.IsNotNull,
    ],
    boolean: [
      FilterOperator.Eq,
      FilterOperator.Neq,
      FilterOperator.IsNull,
      FilterOperator.IsNotNull,
    ],
    date: [
      FilterOperator.Eq,
      FilterOperator.Neq,
      FilterOperator.Gt,
      FilterOperator.Gte,
      FilterOperator.Lt,
      FilterOperator.Lte,
      FilterOperator.IsNull,
      FilterOperator.IsNotNull,
    ],
    datetime: [
      FilterOperator.Eq,
      FilterOperator.Neq,
      FilterOperator.Gt,
      FilterOperator.Gte,
      FilterOperator.Lt,
      FilterOperator.Lte,
      FilterOperator.IsNull,
      FilterOperator.IsNotNull,
    ],
    uuid: [
      FilterOperator.Eq,
      FilterOperator.Neq,
      FilterOperator.In,
      FilterOperator.Nin,
      FilterOperator.IsNull,
      FilterOperator.IsNotNull,
    ],
    json: [FilterOperator.IsNull, FilterOperator.IsNotNull],
    binary: [FilterOperator.IsNull, FilterOperator.IsNotNull],
    unknown: [
      FilterOperator.Eq,
      FilterOperator.Neq,
      FilterOperator.IsNull,
      FilterOperator.IsNotNull,
    ],
  };

  const allowedOps =
    typeCompatibility[columnInfo.type] ?? typeCompatibility.unknown;

  if (!allowedOps.includes(filter.operator)) {
    return {
      valid: false,
      error: `Operator '${filter.operator}' not supported for column type '${columnInfo.type}'`,
    };
  }

  return { valid: true };
}

/**
 * Applies filters to a Kysely query builder.
 */
export function applyFilters<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  filters: FilterCondition[],
  tableInfo: TableInfo,
): SelectQueryBuilder<DB, TB, O> {
  let result = query;

  for (const filter of filters) {
    const column = tableInfo.columns.find((c) => c.name === filter.column);

    if (!column) {
      throw new Error(
        `Column '${filter.column}' not found in table '${tableInfo.name}'`,
      );
    }

    const validation = validateFilter(filter, column);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    result = applyFilterCondition(result, filter);
  }

  return result;
}

function applyFilterCondition<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  filter: FilterCondition,
): SelectQueryBuilder<DB, TB, O> {
  const { column, operator, value } = filter;

  switch (operator) {
    case FilterOperator.Eq:
      return query.where(column as any, '=', value);
    case FilterOperator.Neq:
      return query.where(column as any, '!=', value);
    case FilterOperator.Gt:
      return query.where(column as any, '>', value);
    case FilterOperator.Gte:
      return query.where(column as any, '>=', value);
    case FilterOperator.Lt:
      return query.where(column as any, '<', value);
    case FilterOperator.Lte:
      return query.where(column as any, '<=', value);
    case FilterOperator.Like:
      return query.where(column as any, 'like', value);
    case FilterOperator.Ilike:
      return query.where(column as any, 'ilike', value);
    case FilterOperator.In:
      return query.where(column as any, 'in', value as any[]);
    case FilterOperator.Nin:
      return query.where(column as any, 'not in', value as any[]);
    case FilterOperator.IsNull:
      return query.where(column as any, 'is', null);
    case FilterOperator.IsNotNull:
      return query.where(column as any, 'is not', null);
    default:
      throw new Error(`Unknown filter operator: ${operator}`);
  }
}

/**
 * Applies sorting to a Kysely query builder.
 */
export function applySorting<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  sorts: SortConfig[],
  tableInfo: TableInfo,
): SelectQueryBuilder<DB, TB, O> {
  let result = query;

  for (const sort of sorts) {
    const column = tableInfo.columns.find((c) => c.name === sort.column);

    if (!column) {
      throw new Error(
        `Column '${sort.column}' not found in table '${tableInfo.name}'`,
      );
    }

    result = result.orderBy(
      sort.column as any,
      sort.direction === Direction.Asc ? 'asc' : 'desc',
    );
  }

  return result;
}
