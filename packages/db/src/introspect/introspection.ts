import { type Kysely, sql } from 'kysely';
import type { ColumnInfo, ColumnType, SchemaInfo, TableInfo } from './types';

// Every query aliases its columns to a single lower-case word. A `Kysely` built
// with `CamelCasePlugin` rewrites result keys, so `column_name` would come back
// as `columnName` from one client and `column_name` from another; a one-word
// alias reads the same through both.

/**
 * The schemas the database has, without Postgres's own (`pg_catalog`,
 * `pg_toast`, `information_schema`, …).
 */
export async function listSchemas<DB>(db: Kysely<DB>): Promise<string[]> {
	const { rows } = await sql<{ name: string }>`
		SELECT nspname AS name
		FROM pg_catalog.pg_namespace
		WHERE nspname <> 'information_schema'
			AND nspname NOT LIKE 'pg\\_%'
		ORDER BY nspname
	`.execute(db);

	return rows.map((row) => row.name);
}

export interface IntrospectSchemaOptions {
	/** The schemas to read tables from (default: `['public']`). */
	schemas?: string[];
	/** Tables to leave out, by name. */
	excludeTables?: string[];
}

/**
 * Every base table in the given schemas, with its columns, primary key and
 * foreign keys. Views are left out: they have no key to page by.
 */
export async function introspectSchema<DB>(
	db: Kysely<DB>,
	options: IntrospectSchemaOptions = {},
): Promise<SchemaInfo> {
	const schemas = options.schemas ?? ['public'];
	const excluded = options.excludeTables ?? [];

	const { rows } = await sql<{ name: string; schema: string }>`
		SELECT table_name AS name, table_schema AS schema
		FROM information_schema.tables
		WHERE table_schema = ANY(${schemas})
			AND table_type = 'BASE TABLE'
			AND NOT (table_name = ANY(${excluded}))
		ORDER BY table_schema, table_name
	`.execute(db);

	const tables = await Promise.all(
		rows.map((row) => introspectTable(db, row.name, row.schema)),
	);

	return { tables, updatedAt: new Date() };
}

/**
 * One table's columns, primary key, foreign keys and estimated row count.
 */
export async function introspectTable<DB>(
	db: Kysely<DB>,
	tableName: string,
	schema = 'public',
): Promise<TableInfo> {
	const [columns, foreignKeys, estimate] = await Promise.all([
		sql<{
			name: string;
			udt: string;
			nullable: string;
			fallback: string | null;
			pk: boolean;
		}>`
			SELECT
				c.column_name AS name,
				c.udt_name AS udt,
				c.is_nullable AS nullable,
				c.column_default AS fallback,
				EXISTS (
					SELECT 1
					FROM information_schema.table_constraints tc
					JOIN information_schema.key_column_usage ku
						ON tc.constraint_name = ku.constraint_name
						AND tc.table_schema = ku.table_schema
					WHERE tc.table_name = c.table_name
						AND tc.table_schema = c.table_schema
						AND tc.constraint_type = 'PRIMARY KEY'
						AND ku.column_name = c.column_name
				) AS pk
			FROM information_schema.columns c
			WHERE c.table_name = ${tableName}
				AND c.table_schema = ${schema}
			ORDER BY c.ordinal_position
		`.execute(db),
		sql<{ name: string; target: string; referenced: string }>`
			SELECT
				kcu.column_name AS name,
				ccu.table_name AS target,
				ccu.column_name AS referenced
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
				ON tc.constraint_name = kcu.constraint_name
				AND tc.table_schema = kcu.table_schema
			JOIN information_schema.constraint_column_usage ccu
				ON tc.constraint_name = ccu.constraint_name
				AND tc.table_schema = ccu.table_schema
			WHERE tc.table_name = ${tableName}
				AND tc.table_schema = ${schema}
				AND tc.constraint_type = 'FOREIGN KEY'
		`.execute(db),
		// The planner's estimate rather than `count(*)`, which scans the table.
		// It is -1 for a table never analysed, which is "unknown", not empty.
		sql<{ estimate: string | number }>`
			SELECT c.reltuples::bigint AS estimate
			FROM pg_catalog.pg_class c
			JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relname = ${tableName}
				AND n.nspname = ${schema}
		`.execute(db),
	]);

	const references = new Map(
		foreignKeys.rows.map((row) => [
			row.name,
			{ table: row.target, column: row.referenced },
		]),
	);

	const columnInfo: ColumnInfo[] = columns.rows.map((row) => {
		const reference = references.get(row.name);
		return {
			name: row.name,
			type: mapPostgresType(row.udt),
			rawType: row.udt,
			nullable: row.nullable === 'YES',
			isPrimaryKey: row.pk,
			isForeignKey: !!reference,
			foreignKeyTable: reference?.table,
			foreignKeyColumn: reference?.column,
			defaultValue: row.fallback ?? undefined,
		};
	});

	const rowEstimate = Number(estimate.rows[0]?.estimate ?? 0);

	return {
		name: tableName,
		schema,
		columns: columnInfo,
		primaryKey: columnInfo.filter((c) => c.isPrimaryKey).map((c) => c.name),
		estimatedRowCount: rowEstimate > 0 ? rowEstimate : undefined,
	};
}

const POSTGRES_TYPES: Record<string, ColumnType> = {
	varchar: 'string',
	char: 'string',
	text: 'string',
	name: 'string',
	bpchar: 'string',
	citext: 'string',

	int2: 'number',
	int4: 'number',
	int8: 'number',
	float4: 'number',
	float8: 'number',
	numeric: 'number',
	money: 'number',

	bool: 'boolean',

	date: 'date',
	timestamp: 'datetime',
	timestamptz: 'datetime',
	time: 'datetime',
	timetz: 'datetime',

	json: 'json',
	jsonb: 'json',

	bytea: 'binary',

	uuid: 'uuid',
};

function mapPostgresType(udtName: string): ColumnType {
	return POSTGRES_TYPES[udtName] ?? 'unknown';
}
