import type { Kysely, SelectQueryBuilder } from 'kysely';
import {
  type CursorConfig,
  type DataBrowserOptions,
  Direction,
  type QueryOptions,
  type QueryResult,
  type SchemaInfo,
  type TableInfo,
} from '../types';
import { applyFilters, applySorting } from './filtering';
import { introspectSchema } from './introspection';
import { decodeCursor, encodeCursor } from './pagination';

/**
 * Database browser for introspecting and querying PostgreSQL databases.
 *
 * @example
 * ```typescript
 * const browser = new DataBrowser({
 *   db: kyselyInstance,
 *   cursor: { field: 'id', direction: Direction.Desc },
 * });
 *
 * const schema = await browser.getSchema();
 * const result = await browser.query({ table: 'users', pageSize: 20 });
 * ```
 */
export class DataBrowser<DB = unknown> {
  private db: Kysely<DB>;
  private options: Required<DataBrowserOptions<DB>>;
  private schemaCache: SchemaInfo | null = null;
  private schemaCacheExpiry = 0;
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute

  constructor(options: Required<DataBrowserOptions<DB>>) {
    this.db = options.db;
    this.options = options;
  }

  // ============================================
  // Schema Introspection
  // ============================================

  /**
   * Get the database schema information.
   * Results are cached for 1 minute.
   *
   * @param forceRefresh - Force a refresh of the cache
   */
  async getSchema(forceRefresh = false): Promise<SchemaInfo> {
    const now = Date.now();

    if (!forceRefresh && this.schemaCache && now < this.schemaCacheExpiry) {
      return this.schemaCache;
    }

    const schema = await introspectSchema(this.db, this.options.excludeTables);

    this.schemaCache = schema;
    this.schemaCacheExpiry = now + this.CACHE_TTL_MS;

    return schema;
  }

  /**
   * Get information about a specific table.
   */
  async getTableInfo(tableName: string): Promise<TableInfo | null> {
    const schema = await this.getSchema();
    return schema.tables.find((t) => t.name === tableName) ?? null;
  }

  // ============================================
  // Data Querying
  // ============================================

  /**
   * Query table data with pagination, filtering, and sorting.
   */
  async query(options: QueryOptions): Promise<QueryResult> {
    const tableInfo = await this.getTableInfo(options.table);

    if (!tableInfo) {
      throw new Error(`Table '${options.table}' not found`);
    }

    const cursorConfig = this.getCursorConfig(options.table);
    const pageSize = Math.min(
      options.pageSize ?? this.options.defaultPageSize,
      100,
    );

    // Build base query selecting all columns
    let query = this.db
      .selectFrom(options.table as any)
      .selectAll() as SelectQueryBuilder<any, any, any>;

    // Apply filters if provided
    if (options.filters && options.filters.length > 0) {
      query = applyFilters(query, options.filters, tableInfo);
    }

    // Apply sorting if provided, otherwise use cursor field
    if (options.sort && options.sort.length > 0) {
      query = applySorting(query, options.sort, tableInfo);
    } else {
      query = query.orderBy(cursorConfig.field as any, cursorConfig.direction);
    }

    // Handle cursor-based pagination
    if (options.cursor) {
      const cursorValue = decodeCursor(options.cursor);
      const operator = cursorConfig.direction === Direction.Asc ? '>' : '<';
      query = query.where(cursorConfig.field as any, operator, cursorValue);
    }

    // Fetch one extra row to determine if there are more results
    const rows = await query.limit(pageSize + 1).execute();

    const hasMore = rows.length > pageSize;
    const resultRows = hasMore ? rows.slice(0, pageSize) : rows;

    // Generate cursors
    let nextCursor: string | null = null;
    let prevCursor: string | null = null;

    if (hasMore && resultRows.length > 0) {
      const lastRow = resultRows[resultRows.length - 1];
      nextCursor = encodeCursor(lastRow[cursorConfig.field]);
    }

    // For prev cursor, we need to know if there are previous results
    // This would require a separate query, so we'll only set it if there's an input cursor
    if (options.cursor && resultRows.length > 0) {
      const firstRow = resultRows[0];
      prevCursor = encodeCursor(firstRow[cursorConfig.field]);
    }

    return {
      rows: resultRows,
      hasMore,
      nextCursor,
      prevCursor,
    };
  }

  // ============================================
  // Configuration Access
  // ============================================

  /**
   * Get the cursor configuration for a table.
   * Returns the table-specific config if defined, otherwise the default.
   */
  getCursorConfig(tableName: string): CursorConfig {
    return this.options.tableCursors[tableName] ?? this.options.cursor;
  }

  /**
   * Get the underlying Kysely database instance.
   */
  get database(): Kysely<DB> {
    return this.db;
  }
}
