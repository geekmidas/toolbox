/**
 * What a row query can get wrong. Each is the caller's mistake rather than the
 * database's, so the JSON handler answers them as 4xx with the class name as
 * the error code — a client matches on that, not on the message.
 */

/** A table that is not in the browsable schemas, or was excluded. */
export class TableNotFound extends Error {
	constructor(
		readonly table: string,
		readonly schema: string,
	) {
		super(
			`There is no table '${table}' in schema '${schema}'. List the tables to see what can be browsed; an excluded table is left out on purpose.`,
		);
		this.name = 'TableNotFound';
	}
}

/** A filter or sort naming a column the table does not have. */
export class ColumnNotFound extends Error {
	constructor(
		readonly column: string,
		readonly table: string,
	) {
		super(
			`Table '${table}' has no column '${column}'. Use a column name exactly as the table description lists it.`,
		);
		this.name = 'ColumnNotFound';
	}
}

/** A filter operator that does not apply to the column's type. */
export class UnsupportedFilterOperator extends Error {
	constructor(
		readonly operator: string,
		readonly column: string,
		readonly columnType: string,
	) {
		super(
			`'${operator}' cannot filter '${column}', a ${columnType} column. Use an operator that applies to ${columnType} values.`,
		);
		this.name = 'UnsupportedFilterOperator';
	}
}
