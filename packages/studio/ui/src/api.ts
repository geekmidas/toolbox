import type {
  FilterConfig,
  QueryResult,
  SchemaInfo,
  SortConfig,
  TableInfo,
  TableSummary,
} from './types';

const BASE_URL = '/__studio';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export async function getSchema(refresh = false): Promise<SchemaInfo> {
  const url = refresh ? '/api/schema?refresh=true' : '/api/schema';
  return fetchJson(url);
}

export async function getTables(): Promise<{ tables: TableSummary[] }> {
  return fetchJson('/api/tables');
}

export async function getTableInfo(tableName: string): Promise<TableInfo> {
  return fetchJson(`/api/tables/${encodeURIComponent(tableName)}`);
}

export interface QueryOptions {
  pageSize?: number;
  cursor?: string;
  filters?: FilterConfig[];
  sort?: SortConfig[];
}

export async function queryTable(
  tableName: string,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const params = new URLSearchParams();

  if (options.pageSize) {
    params.set('pageSize', String(options.pageSize));
  }

  if (options.cursor) {
    params.set('cursor', options.cursor);
  }

  if (options.filters) {
    for (const filter of options.filters) {
      params.set(`filter[${filter.column}][${filter.operator}]`, filter.value);
    }
  }

  if (options.sort && options.sort.length > 0) {
    const sortStr = options.sort
      .map((s) => `${s.column}:${s.direction}`)
      .join(',');
    params.set('sort', sortStr);
  }

  const queryStr = params.toString();
  const url = `/api/tables/${encodeURIComponent(tableName)}/rows${queryStr ? `?${queryStr}` : ''}`;

  return fetchJson(url);
}
