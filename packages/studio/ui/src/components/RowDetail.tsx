import type { ColumnInfo } from '../types';

interface RowDetailProps {
  row: Record<string, unknown>;
  columns: ColumnInfo[];
  onClose: () => void;
}

export function RowDetail({ row, columns, onClose }: RowDetailProps) {
  const formatValue = (value: unknown): string => {
    if (value === null) return 'NULL';
    if (value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  const getValueClass = (value: unknown): string => {
    if (value === null) return 'text-slate-500 italic';
    if (typeof value === 'boolean')
      return value ? 'text-green-400' : 'text-red-400';
    if (typeof value === 'number') return 'text-blue-400';
    if (typeof value === 'string' && value.length > 100)
      return 'text-slate-300 text-xs';
    return 'text-slate-300';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-secondary border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-slate-100">Row Details</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 transition-colors text-xl"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {columns.map((col) => {
              const value = row[col.name];
              const isLongValue =
                typeof value === 'string' && value.length > 100;
              const isJson = typeof value === 'object' && value !== null;

              return (
                <div key={col.name} className="border-b border-border pb-3">
                  {/* Column name and metadata */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-slate-200">
                      {col.name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {col.rawType}
                    </span>
                    {col.isPrimaryKey && (
                      <span className="text-xs text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                        PK
                      </span>
                    )}
                    {col.isForeignKey && (
                      <span className="text-xs text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">
                        FK
                      </span>
                    )}
                    {col.nullable && (
                      <span className="text-xs text-slate-500">nullable</span>
                    )}
                  </div>

                  {/* Value */}
                  {isLongValue || isJson ? (
                    <pre
                      className={`${getValueClass(value)} bg-bg-tertiary p-2 rounded overflow-x-auto whitespace-pre-wrap break-words`}
                    >
                      {formatValue(value)}
                    </pre>
                  ) : (
                    <div className={getValueClass(value)}>
                      {formatValue(value)}
                    </div>
                  )}

                  {/* Foreign key reference */}
                  {col.isForeignKey && col.foreignKeyTable && (
                    <div className="mt-1 text-xs text-blue-400">
                      References: {col.foreignKeyTable}.{col.foreignKeyColumn}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bg-tertiary hover:bg-slate-600 rounded transition-colors text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
