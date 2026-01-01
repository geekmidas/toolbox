import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { QueryResult, SortConfig, TableInfo } from '../types';

interface TableViewProps {
  tableName: string;
  tableInfo: TableInfo | null;
  onRowSelect: (row: Record<string, unknown>) => void;
}

export function TableView({
  tableName,
  tableInfo,
  onRowSelect,
}: TableViewProps) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortConfig[]>([]);
  const [pageSize] = useState(50);

  const loadData = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.queryTable(tableName, {
          pageSize,
          cursor,
          sort: sort.length > 0 ? sort : undefined,
        });
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    },
    [tableName, pageSize, sort],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSort = useCallback((column: string) => {
    setSort((prev) => {
      const existing = prev.find((s) => s.column === column);
      if (!existing) {
        return [{ column, direction: 'asc' }];
      }
      if (existing.direction === 'asc') {
        return [{ column, direction: 'desc' }];
      }
      return [];
    });
  }, []);

  const handleNextPage = useCallback(() => {
    if (data?.nextCursor) {
      loadData(data.nextCursor);
    }
  }, [data, loadData]);

  const formatValue = (value: unknown): string => {
    if (value === null) return 'NULL';
    if (value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const getColumnWidth = (columnName: string): string => {
    // Give more space to certain columns
    if (columnName.includes('id')) return 'min-w-24';
    if (columnName.includes('name') || columnName.includes('title'))
      return 'min-w-48';
    if (columnName.includes('description') || columnName.includes('content'))
      return 'min-w-64';
    if (columnName.includes('created') || columnName.includes('updated'))
      return 'min-w-40';
    return 'min-w-32';
  };

  if (!tableInfo) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        Loading table info...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  const columns = tableInfo.columns;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Column Info Bar */}
      <div className="bg-bg-secondary border-b border-border px-4 py-2 flex items-center gap-4 text-sm">
        <span className="text-slate-400">{columns.length} columns</span>
        {tableInfo.estimatedRowCount !== undefined && (
          <span className="text-slate-400">
            ~{tableInfo.estimatedRowCount.toLocaleString()} rows
          </span>
        )}
        {sort.length > 0 && (
          <span className="text-purple-400">
            Sorted by: {sort[0].column} ({sort[0].direction})
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-bg-secondary z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.name}
                  onClick={() => handleSort(col.name)}
                  className={`text-left px-3 py-2 text-sm font-medium text-slate-300 border-b border-border cursor-pointer hover:bg-bg-tertiary transition-colors ${getColumnWidth(col.name)}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate">{col.name}</span>
                    {col.isPrimaryKey && (
                      <span className="text-xs text-amber-400">PK</span>
                    )}
                    {col.isForeignKey && (
                      <span className="text-xs text-blue-400">FK</span>
                    )}
                    {sort.find((s) => s.column === col.name) && (
                      <span className="text-purple-400">
                        {sort[0].direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-normal">
                    {col.rawType}
                    {col.nullable && ' ?'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center py-8 text-slate-500"
                >
                  Loading...
                </td>
              </tr>
            ) : data?.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center py-8 text-slate-500"
                >
                  No data found
                </td>
              </tr>
            ) : (
              data?.rows.map((row, idx) => (
                <tr
                  key={idx}
                  onClick={() => onRowSelect(row)}
                  className="border-b border-border hover:bg-bg-tertiary cursor-pointer transition-colors"
                >
                  {columns.map((col) => (
                    <td
                      key={col.name}
                      className={`px-3 py-2 text-sm truncate max-w-xs ${
                        row[col.name] === null
                          ? 'text-slate-500 italic'
                          : 'text-slate-300'
                      }`}
                    >
                      {formatValue(row[col.name])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && (
        <div className="bg-bg-secondary border-t border-border px-4 py-2 flex items-center justify-between text-sm">
          <span className="text-slate-400">
            Showing {data.rows.length} rows
          </span>
          <div className="flex items-center gap-2">
            {data.hasMore && (
              <button
                onClick={handleNextPage}
                disabled={loading}
                className="px-3 py-1 bg-bg-tertiary hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
