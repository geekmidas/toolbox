import type { Tab } from '../types';

export interface RequestFilters {
  search: string;
  method: string;
  status: string;
}

export interface LogFilters {
  search: string;
  level: string;
}

export interface ExceptionFilters {
  search: string;
}

interface FilterBarProps {
  tab: Tab;
  requestFilters: RequestFilters;
  logFilters: LogFilters;
  exceptionFilters: ExceptionFilters;
  onRequestFiltersChange: (filters: RequestFilters) => void;
  onLogFiltersChange: (filters: LogFilters) => void;
  onExceptionFiltersChange: (filters: ExceptionFilters) => void;
  onClear: () => void;
}

const HTTP_METHODS = ['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const STATUS_RANGES = [
  { value: '', label: 'All Status' },
  { value: '2xx', label: '2xx Success' },
  { value: '3xx', label: '3xx Redirect' },
  { value: '4xx', label: '4xx Client Error' },
  { value: '5xx', label: '5xx Server Error' },
];
const LOG_LEVELS = ['', 'debug', 'info', 'warn', 'error'];

export function FilterBar({
  tab,
  requestFilters,
  logFilters,
  exceptionFilters,
  onRequestFiltersChange,
  onLogFiltersChange,
  onExceptionFiltersChange,
  onClear,
}: FilterBarProps) {
  const hasActiveFilters =
    (tab === 'requests' &&
      (requestFilters.search ||
        requestFilters.method ||
        requestFilters.status)) ||
    (tab === 'logs' && (logFilters.search || logFilters.level)) ||
    (tab === 'exceptions' && exceptionFilters.search);

  return (
    <div className="bg-bg-secondary border-b border-border px-4 py-3 flex items-center gap-3">
      {tab === 'requests' && (
        <>
          <input
            type="text"
            placeholder="Search path..."
            value={requestFilters.search}
            onChange={(e) =>
              onRequestFiltersChange({
                ...requestFilters,
                search: e.target.value,
              })
            }
            className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 w-64"
          />
          <select
            value={requestFilters.method}
            onChange={(e) =>
              onRequestFiltersChange({
                ...requestFilters,
                method: e.target.value,
              })
            }
            className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Methods</option>
            {HTTP_METHODS.filter(Boolean).map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
          <select
            value={requestFilters.status}
            onChange={(e) =>
              onRequestFiltersChange({
                ...requestFilters,
                status: e.target.value,
              })
            }
            className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {STATUS_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </>
      )}

      {tab === 'logs' && (
        <>
          <input
            type="text"
            placeholder="Search message..."
            value={logFilters.search}
            onChange={(e) =>
              onLogFiltersChange({ ...logFilters, search: e.target.value })
            }
            className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 w-64"
          />
          <select
            value={logFilters.level}
            onChange={(e) =>
              onLogFiltersChange({ ...logFilters, level: e.target.value })
            }
            className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Levels</option>
            {LOG_LEVELS.filter(Boolean).map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </>
      )}

      {tab === 'exceptions' && (
        <input
          type="text"
          placeholder="Search exception..."
          value={exceptionFilters.search}
          onChange={(e) =>
            onExceptionFiltersChange({
              ...exceptionFilters,
              search: e.target.value,
            })
          }
          className="bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 w-64"
        />
      )}

      {hasActiveFilters && (
        <button
          onClick={onClear}
          className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-bg-tertiary transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
