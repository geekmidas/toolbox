import { NoResults } from '@geekmidas/ui';
import { AlertTriangle, ArrowLeft, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from '../api';
import { useStudio } from '../providers/StudioProvider';
import type { ExceptionEntry } from '../types';

interface ExceptionFilters {
  search: string;
}

export function ExceptionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { exceptions: realtimeExceptions } = useStudio();

  const [exceptions, setExceptions] = useState<ExceptionEntry[]>([]);
  const [selectedException, setSelectedException] =
    useState<ExceptionEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ExceptionFilters>({
    search: '',
  });

  // Merge realtime exceptions with fetched exceptions
  useEffect(() => {
    setExceptions((prev) => {
      const existingIds = new Set(prev.map((e) => e.id));
      const newExceptions = realtimeExceptions.filter(
        (e) => !existingIds.has(e.id),
      );
      if (newExceptions.length > 0) {
        return [...newExceptions, ...prev].slice(0, 100);
      }
      return prev;
    });
  }, [realtimeExceptions]);

  // Load exceptions
  const loadExceptions = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getExceptions({
        limit: 100,
        search: filters.search || undefined,
      });
      setExceptions(data);
    } catch (error) {
      console.error('Failed to load exceptions:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadExceptions();
  }, [loadExceptions]);

  // Load selected exception detail
  useEffect(() => {
    if (id) {
      const existing = exceptions.find((e) => e.id === id);
      if (existing) {
        setSelectedException(existing);
      } else {
        api.getException(id).then(setSelectedException).catch(console.error);
      }
    } else {
      setSelectedException(null);
    }
  }, [id, exceptions]);

  // Filter exceptions
  const filteredExceptions = useMemo(() => {
    return exceptions.filter((exception) => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        if (
          !exception.name.toLowerCase().includes(searchLower) &&
          !exception.message.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [exceptions, filters]);

  const hasFilters = filters.search;

  const clearFilters = () => {
    setFilters({ search: '' });
  };

  return (
    <div className="flex h-full">
      {/* Exception List */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Filter Bar */}
        <div className="p-4 border-b border-border bg-surface flex items-center gap-4">
          <input
            type="text"
            placeholder="Search exceptions..."
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
            className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
          />
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* Exception List */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              Loading...
            </div>
          ) : filteredExceptions.length === 0 ? (
            <NoResults
              title={hasFilters ? 'No matching exceptions' : 'No exceptions'}
              description={
                hasFilters
                  ? 'Try adjusting your filters.'
                  : 'Exceptions will appear here when they occur.'
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {filteredExceptions.map((exception) => (
                <div
                  key={exception.id}
                  className={`bg-surface border rounded-lg p-4 cursor-pointer transition-colors hover:border-accent/50 ${
                    selectedException?.id === exception.id
                      ? 'border-accent'
                      : 'border-border'
                  }`}
                  onClick={() => navigate(`/exceptions/${exception.id}`)}
                >
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                      <span className="font-medium text-red-400">
                        {exception.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(exception.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate pl-6">
                    {exception.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Exception Detail Panel */}
      {selectedException && (
        <ExceptionDetailPanel
          exception={selectedException}
          onClose={() => navigate('/exceptions')}
        />
      )}
    </div>
  );
}

function ExceptionDetailPanel({
  exception,
  onClose,
}: {
  exception: ExceptionEntry;
  onClose: () => void;
}) {
  return (
    <div className="w-[600px] border-l border-border bg-surface flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-hover rounded"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="font-medium text-red-400">{exception.name}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatTime(exception.timestamp)}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-surface-hover rounded"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Message */}
        <div>
          <h4 className="text-sm font-medium mb-2">Message</h4>
          <p className="text-sm bg-background rounded p-3 break-words text-red-300">
            {exception.message}
          </p>
        </div>

        {/* Request info */}
        {exception.request && (
          <div>
            <h4 className="text-sm font-medium mb-2">Request</h4>
            <p className="text-sm font-mono bg-background rounded p-3">
              {exception.request.method} {exception.request.path}
            </p>
          </div>
        )}

        {/* Stack trace */}
        {exception.stack && (
          <div>
            <h4 className="text-sm font-medium mb-2">Stack Trace</h4>
            <pre className="bg-background rounded p-3 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap">
              {formatStackTrace(exception.stack)}
            </pre>
          </div>
        )}

        {/* Context */}
        {exception.context && Object.keys(exception.context).length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Context</h4>
            <pre className="bg-background rounded p-3 text-xs overflow-auto max-h-[200px]">
              {JSON.stringify(exception.context, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function formatStackTrace(stack: string) {
  // Highlight file paths and line numbers
  return stack;
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleString();
}
