import type { SelectQueryBuilder } from 'kysely';
import { Direction } from '../pagination';
import { ColumnNotFound, UnsupportedFilterOperator } from './errors';
import {
	type ColumnInfo,
	type ColumnType,
	type FilterCondition,
	FilterOperator,
	type SortConfig,
	type TableInfo,
} from './types';

const NULLS = [FilterOperator.IsNull, FilterOperator.IsNotNull];
const EQUALITY = [FilterOperator.Eq, FilterOperator.Neq, ...NULLS];
const ORDERED = [
	...EQUALITY,
	FilterOperator.Gt,
	FilterOperator.Gte,
	FilterOperator.Lt,
	FilterOperator.Lte,
];
const MEMBERSHIP = [FilterOperator.In, FilterOperator.Nin];

/** Which operators make sense for each column type. */
const OPERATORS: Record<ColumnType, FilterOperator[]> = {
	string: [
		...EQUALITY,
		FilterOperator.Like,
		FilterOperator.Ilike,
		...MEMBERSHIP,
	],
	number: [...ORDERED, ...MEMBERSHIP],
	boolean: EQUALITY,
	date: ORDERED,
	datetime: ORDERED,
	uuid: [...EQUALITY, ...MEMBERSHIP],
	json: NULLS,
	binary: NULLS,
	unknown: EQUALITY,
};

/**
 * Whether a filter's operator applies to the column it names.
 */
export function validateFilter(
	filter: FilterCondition,
	column: ColumnInfo,
): { valid: true } | { valid: false; error: UnsupportedFilterOperator } {
	if (OPERATORS[column.type].includes(filter.operator)) {
		return { valid: true };
	}

	return {
		valid: false,
		error: new UnsupportedFilterOperator(
			filter.operator,
			column.name,
			column.type,
		),
	};
}

/**
 * Adds each filter to the query as a `where`, after checking the column exists
 * and the operator applies to it.
 *
 * @throws {ColumnNotFound} a filter names a column the table does not have
 * @throws {UnsupportedFilterOperator} an operator does not apply to its column
 */
export function applyFilters<DB, TB extends keyof DB, O>(
	query: SelectQueryBuilder<DB, TB, O>,
	filters: FilterCondition[],
	table: TableInfo,
): SelectQueryBuilder<DB, TB, O> {
	let result = query;

	for (const filter of filters) {
		const column = table.columns.find((c) => c.name === filter.column);
		if (!column) {
			throw new ColumnNotFound(filter.column, table.name);
		}

		const validation = validateFilter(filter, column);
		if (!validation.valid) {
			throw validation.error;
		}

		result = applyFilterCondition(result, filter);
	}

	return result;
}

function applyFilterCondition<DB, TB extends keyof DB, O>(
	query: SelectQueryBuilder<DB, TB, O>,
	filter: FilterCondition,
): SelectQueryBuilder<DB, TB, O> {
	// The column was checked against the introspected table, which the query's
	// static types know nothing about.
	const column = filter.column as any;
	const { value } = filter;

	switch (filter.operator) {
		case FilterOperator.Eq:
			return query.where(column, '=', value);
		case FilterOperator.Neq:
			return query.where(column, '!=', value);
		case FilterOperator.Gt:
			return query.where(column, '>', value);
		case FilterOperator.Gte:
			return query.where(column, '>=', value);
		case FilterOperator.Lt:
			return query.where(column, '<', value);
		case FilterOperator.Lte:
			return query.where(column, '<=', value);
		case FilterOperator.Like:
			return query.where(column, 'like', value);
		case FilterOperator.Ilike:
			return query.where(column, 'ilike', value);
		case FilterOperator.In:
			return query.where(column, 'in', value as unknown[]);
		case FilterOperator.Nin:
			return query.where(column, 'not in', value as unknown[]);
		case FilterOperator.IsNull:
			return query.where(column, 'is', null);
		case FilterOperator.IsNotNull:
			return query.where(column, 'is not', null);
	}
}

/**
 * Adds an `order by` per sort, in the order given.
 *
 * @throws {ColumnNotFound} a sort names a column the table does not have
 */
export function applySorting<DB, TB extends keyof DB, O>(
	query: SelectQueryBuilder<DB, TB, O>,
	sorts: SortConfig[],
	table: TableInfo,
): SelectQueryBuilder<DB, TB, O> {
	let result = query;

	for (const sort of sorts) {
		if (!table.columns.some((c) => c.name === sort.column)) {
			throw new ColumnNotFound(sort.column, table.name);
		}

		result = result.orderBy(
			sort.column as any,
			sort.direction === Direction.Asc ? 'asc' : 'desc',
		);
	}

	return result;
}
