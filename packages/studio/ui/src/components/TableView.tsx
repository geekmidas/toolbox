import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type {
  FilterConfig,
  QueryResult,
  SortConfig,
  TableInfo,
} from '../types';
import { FilterPanel } from './FilterPanel';

interface TableViewProps {
  tableName: string;
  tableInfo: TableInfo | null;
  onRowSelect: (row: Record<string, unknown>) => void;
}

const PAGE_SIZES = [25, 50, 100];

// Column type icons
function ColumnTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'string':
      return (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h7"
          />
        </svg>
      );
    case 'number':
      return (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"
          />
        </svg>
      );
    case 'boolean':
      return (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case 'date':
    case 'datetime':
      return (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      );
    case 'json':
      return (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
          />
        </svg>
      );
    case 'uuid':
      return (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
      );
    default:
      return (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16m-7 6h7"
          />
        </svg>
      );
  }
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
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [cursors, setCursors] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);

  const loadData = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        // Filter out filters with empty values (except is_null/is_not_null which don't need values)
        const validFilters = filters.filter(
          (f) =>
            f.operator === 'is_null' ||
            f.operator === 'is_not_null' ||
            (f.value && f.value.trim() !== ''),
        );

        const result = await api.queryTable(tableName, {
          pageSize,
          cursor,
          sort: sort.length > 0 ? sort : undefined,
          filters: validFilters.length > 0 ? validFilters : undefined,
        });
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    },
    [tableName, pageSize, sort, filters],
  );

  // Reset and reload when table, sort, or filters change
  useEffect(() => {
    setCursors([]);
    setCurrentPage(0);
    loadData();
  }, [tableName, sort, filters, pageSize]);

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
      setCursors((prev) => [...prev, data.nextCursor!]);
      setCurrentPage((prev) => prev + 1);
      loadData(data.nextCursor);
    }
  }, [data, loadData]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 0) {
      const newCursors = cursors.slice(0, -1);
      setCursors(newCursors);
      setCurrentPage((prev) => prev - 1);
      loadData(newCursors[newCursors.length - 1] || undefined);
    }
  }, [currentPage, cursors, loadData]);

  const formatValue = (value: unknown): string => {
    if (value === null) return 'NULL';
    if (value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  if (!tableInfo) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading table info...
        </div>
      </div>
    );
  }

  const columns = tableInfo.columns;
  const startRow = currentPage * pageSize + 1;
  const endRow = startRow + (data?.rows.length || 0) - 1;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-studio-bg">
      {/* Toolbar */}
      <div className="bg-studio-surface border-b border-studio-border px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {/* Filter button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn btn-default ${showFilters || filters.length > 0 ? 'text-emerald-400' : ''}`}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            Filter
            {filters.length > 0 && (
              <span className="badge">{filters.length}</span>
            )}
          </button>

          {/* Sort indicator */}
          {sort.length > 0 && (
            <div className="flex items-center gap-1 text-sm text-slate-400">
              <span>Sorted by</span>
              <span className="text-emerald-400">{sort[0].column}</span>
              <span>({sort[0].direction})</span>
              <button
                onClick={() => setSort([])}
                className="p-0.5 hover:bg-studio-hover rounded"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm text-slate-400">
          {tableInfo.estimatedRowCount !== undefined && (
            <span>{tableInfo.estimatedRowCount.toLocaleString()} rows</span>
          )}
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <FilterPanel
          columns={columns}
          filters={filters}
          onFiltersChange={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Data Grid */}
      <div className="flex-1 overflow-auto">
        <table className="data-grid">
          <thead>
            <tr>
              {/* Row number header */}
              <th className="w-12 px-3 py-2 text-xs font-normal text-slate-500 bg-studio-surface">
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col.name}
                  onClick={() => handleSort(col.name)}
                  className="px-3 py-2 text-left cursor-pointer hover:bg-studio-hover transition-colors bg-studio-surface"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">
                      <ColumnTypeIcon type={col.type} />
                    </span>
                    <span className="text-sm font-medium text-slate-300 truncate">
                      {col.name}
                    </span>
                    {col.isPrimaryKey && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
                        PK
                      </span>
                    )}
                    {col.isForeignKey && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400">
                        FK
                      </span>
                    )}
                    {sort.find((s) => s.column === col.name) && (
                      <span className="text-emerald-400">
                        {sort[0].direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="text-center py-8 text-slate-500"
                >
                  <div className="flex items-center justify-center gap-2">
                    <svg
                      className="w-5 h-5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Loading...
                  </div>
                </td>
              </tr>
            ) : data?.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
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
                  className="cursor-pointer"
                >
                  {/* Row number */}
                  <td className="row-number px-3 py-2 text-right">
                    {startRow + idx}
                  </td>
                  {columns.map((col) => (
                    <td
                      key={col.name}
                      className={`px-3 py-2 text-sm max-w-xs truncate ${
                        row[col.name] === null ? 'cell-null' : 'text-slate-300'
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
      <div className="bg-studio-surface border-t border-studio-border px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="select py-1"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          {data && data.rows.length > 0 && (
            <span>
              Showing {startRow} - {endRow}
              {tableInfo.estimatedRowCount !== undefined &&
                ` of ${tableInfo.estimatedRowCount.toLocaleString()}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevPage}
            disabled={currentPage === 0 || loading}
            className="btn btn-default disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Previous
          </button>
          <button
            onClick={handleNextPage}
            disabled={!data?.hasMore || loading}
            className="btn btn-default disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
