import type { Kysely } from 'kysely';
import type { ColumnInfo, ColumnType, SchemaInfo, TableInfo } from '../types';

/**
 * Introspects the database schema to discover tables and columns.
 * Uses PostgreSQL information_schema for metadata.
 */
export async function introspectSchema<DB>(
	db: Kysely<DB>,
	excludeTables: string[],
): Promise<SchemaInfo> {
	// Query tables from information_schema
	const excludePlaceholders =
		excludeTables.length > 0
			? excludeTables.map((_, i) => `$${i + 1}`).join(', ')
			: "''";

	const tablesQuery = `
    SELECT
      table_name,
      table_schema
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ${excludeTables.length > 0 ? `AND table_name NOT IN (${excludePlaceholders})` : ''}
    ORDER BY table_name
  `;

	const tablesResult = await db.executeQuery({
		sql: tablesQuery,
		parameters: excludeTables,
	} as any);

	const tables: TableInfo[] = [];

	for (const row of tablesResult.rows as any[]) {
		// Support both snake_case (raw) and camelCase (with CamelCasePlugin)
		const tableName = row.table_name ?? row.tableName;
		const tableSchema = row.table_schema ?? row.tableSchema;
		const tableInfo = await introspectTable(db, tableName, tableSchema);
		tables.push(tableInfo);
	}

	return {
		tables,
		updatedAt: new Date(),
	};
}

/**
 * Introspects a single table to get column information.
 */
export async function introspectTable<DB>(
	db: Kysely<DB>,
	tableName: string,
	schema = 'public',
): Promise<TableInfo> {
	// Query columns
	const columnsQuery = `
    SELECT
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default,
      CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT ku.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
        AND tc.table_schema = ku.table_schema
      WHERE tc.table_name = $1
        AND tc.table_schema = $2
        AND tc.constraint_type = 'PRIMARY KEY'
    ) pk ON c.column_name = pk.column_name
    WHERE c.table_name = $1
      AND c.table_schema = $2
    ORDER BY c.ordinal_position
  `;

	const columnsResult = await db.executeQuery({
		sql: columnsQuery,
		parameters: [tableName, schema],
	} as any);

	// Query foreign keys
	const fkQuery = `
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table,
      ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.table_name = $1
      AND tc.table_schema = $2
      AND tc.constraint_type = 'FOREIGN KEY'
  `;

	const fkResult = await db.executeQuery({
		sql: fkQuery,
		parameters: [tableName, schema],
	} as any);

	const foreignKeys = new Map<string, { table: string; column: string }>();
	for (const row of fkResult.rows as any[]) {
		// Support both snake_case (raw) and camelCase (with CamelCasePlugin)
		const colName = row.column_name ?? row.columnName;
		foreignKeys.set(colName, {
			table: row.foreign_table ?? row.foreignTable,
			column: row.foreign_column ?? row.foreignColumn,
		});
	}

	const columns: ColumnInfo[] = (columnsResult.rows as any[]).map((row) => {
		// Support both snake_case (raw) and camelCase (with CamelCasePlugin)
		const colName = row.column_name ?? row.columnName;
		const udtName = row.udt_name ?? row.udtName;
		const isNullable = row.is_nullable ?? row.isNullable;
		const isPrimaryKey = row.is_primary_key ?? row.isPrimaryKey;
		const columnDefault = row.column_default ?? row.columnDefault;

		const fk = foreignKeys.get(colName);
		return {
			name: colName,
			type: mapPostgresType(udtName),
			rawType: udtName,
			nullable: isNullable === 'YES',
			isPrimaryKey: isPrimaryKey,
			isForeignKey: !!fk,
			foreignKeyTable: fk?.table,
			foreignKeyColumn: fk?.column,
			defaultValue: columnDefault ?? undefined,
		};
	});

	const primaryKey = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

	// Get estimated row count
	const countQuery = `
    SELECT reltuples::bigint AS estimate
    FROM pg_class
    WHERE relname = $1
  `;

	let estimatedRowCount: number | undefined;
	try {
		const countResult = await db.executeQuery({
			sql: countQuery,
			parameters: [tableName],
		} as any);
		if (countResult.rows.length > 0) {
			const estimate = (countResult.rows[0] as any).estimate;
			estimatedRowCount = estimate > 0 ? Number(estimate) : undefined;
		}
	} catch {
		// Ignore errors, row count is optional
	}

	return {
		name: tableName,
		schema,
		columns,
		primaryKey,
		estimatedRowCount,
	};
}

/**
 * Maps PostgreSQL types to generic column types.
 */
function mapPostgresType(udtName: string): ColumnType {
	const typeMap: Record<string, ColumnType> = {
		// Strings
		varchar: 'string',
		char: 'string',
		text: 'string',
		name: 'string',
		bpchar: 'string',

		// Numbers
		int2: 'number',
		int4: 'number',
		int8: 'number',
		float4: 'number',
		float8: 'number',
		numeric: 'number',
		money: 'number',
		serial: 'number',
		bigserial: 'number',

		// Boolean
		bool: 'boolean',

		// Dates
		date: 'date',
		timestamp: 'datetime',
		timestamptz: 'datetime',
		time: 'datetime',
		timetz: 'datetime',

		// JSON
		json: 'json',
		jsonb: 'json',

		// Binary
		bytea: 'binary',

		// UUID
		uuid: 'uuid',
	};

	return typeMap[udtName] ?? 'unknown';
}
