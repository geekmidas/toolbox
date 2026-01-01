import { useCallback } from 'react';
import type { ColumnInfo, FilterConfig } from '../types';

interface FilterPanelProps {
  columns: ColumnInfo[];
  filters: FilterConfig[];
  onFiltersChange: (filters: FilterConfig[]) => void;
  onClose: () => void;
}

const OPERATORS: { value: string; label: string; types?: string[] }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'gt', label: 'greater than', types: ['number', 'date', 'datetime'] },
  {
    value: 'gte',
    label: 'greater than or equal',
    types: ['number', 'date', 'datetime'],
  },
  { value: 'lt', label: 'less than', types: ['number', 'date', 'datetime'] },
  {
    value: 'lte',
    label: 'less than or equal',
    types: ['number', 'date', 'datetime'],
  },
  { value: 'like', label: 'contains', types: ['string'] },
  { value: 'ilike', label: 'contains (case insensitive)', types: ['string'] },
  { value: 'is_null', label: 'is null' },
  { value: 'is_not_null', label: 'is not null' },
];

function getOperatorsForColumn(column: ColumnInfo) {
  return OPERATORS.filter(
    (op) => !op.types || op.types.includes(column.type || 'string'),
  );
}

export function FilterPanel({
  columns,
  filters,
  onFiltersChange,
  onClose,
}: FilterPanelProps) {
  const addFilter = useCallback(() => {
    const firstColumn = columns[0];
    if (!firstColumn) return;

    onFiltersChange([
      ...filters,
      { column: firstColumn.name, operator: 'eq', value: '' },
    ]);
  }, [columns, filters, onFiltersChange]);

  const updateFilter = useCallback(
    (index: number, updates: Partial<FilterConfig>) => {
      const newFilters = [...filters];
      newFilters[index] = { ...newFilters[index], ...updates };
      onFiltersChange(newFilters);
    },
    [filters, onFiltersChange],
  );

  const removeFilter = useCallback(
    (index: number) => {
      onFiltersChange(filters.filter((_, i) => i !== index));
    },
    [filters, onFiltersChange],
  );

  const clearAll = useCallback(() => {
    onFiltersChange([]);
  }, [onFiltersChange]);

  return (
    <div className="filter-panel bg-studio-surface border-b border-studio-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-300">Filters</h3>
        <div className="flex items-center gap-2">
          {filters.length > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-studio-hover rounded transition-colors"
          >
            <svg
              className="w-4 h-4 text-slate-400"
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
      </div>

      <div className="space-y-2">
        {filters.map((filter, index) => {
          const column = columns.find((c) => c.name === filter.column);
          const operators = column ? getOperatorsForColumn(column) : OPERATORS;
          const needsValue = !['is_null', 'is_not_null'].includes(
            filter.operator,
          );

          return (
            <div key={index} className="flex items-center gap-2">
              {index > 0 && (
                <span className="text-xs text-slate-500 w-8">and</span>
              )}
              {index === 0 && <span className="text-xs text-slate-500 w-8">Where</span>}

              {/* Column select */}
              <select
                value={filter.column}
                onChange={(e) => updateFilter(index, { column: e.target.value })}
                className="select flex-1 min-w-0"
              >
                {columns.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name}
                  </option>
                ))}
              </select>

              {/* Operator select */}
              <select
                value={filter.operator}
                onChange={(e) =>
                  updateFilter(index, { operator: e.target.value })
                }
                className="select w-48"
              >
                {operators.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              {/* Value input */}
              {needsValue && (
                <input
                  type="text"
                  value={filter.value}
                  onChange={(e) => updateFilter(index, { value: e.target.value })}
                  placeholder="Enter value..."
                  className="input flex-1 min-w-0"
                />
              )}

              {/* Remove button */}
              <button
                onClick={() => removeFilter(index)}
                className="p-1.5 hover:bg-studio-hover rounded transition-colors text-slate-500 hover:text-slate-300"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={addFilter}
        className="mt-3 flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
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
            d="M12 4v16m8-8H4"
          />
        </svg>
        Add filter
      </button>
    </div>
  );
}
