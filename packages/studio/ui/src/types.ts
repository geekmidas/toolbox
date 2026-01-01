export interface ColumnInfo {
  name: string;
  type: string;
  rawType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyTable?: string;
  foreignKeyColumn?: string;
  defaultValue?: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  estimatedRowCount?: number;
}

export interface TableSummary {
  name: string;
  schema: string;
  columnCount: number;
  primaryKey: string[];
  estimatedRowCount?: number;
}

export interface SchemaInfo {
  tables: TableInfo[];
  updatedAt: string;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
}

export interface FilterConfig {
  column: string;
  operator: string;
  value: string;
}

export interface SortConfig {
  column: string;
  direction: 'asc' | 'desc';
}
