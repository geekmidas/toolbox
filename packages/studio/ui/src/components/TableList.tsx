import type { TableSummary } from '../types';

interface TableListProps {
  tables: TableSummary[];
  onSelect: (tableName: string) => void;
}

export function TableList({ tables, onSelect }: TableListProps) {
  if (tables.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
        <h3 className="text-lg mb-2">No tables found</h3>
        <p className="text-sm">
          Make sure your database has tables in the public schema.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tables.map((table) => (
          <div
            key={table.name}
            onClick={() => onSelect(table.name)}
            className="bg-bg-secondary border border-border rounded-lg p-4 cursor-pointer transition-colors hover:border-purple-500 hover:bg-bg-tertiary"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-100 truncate">
                {table.name}
              </h3>
              <span className="text-xs text-slate-500">{table.schema}</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-slate-400">
              <span>{table.columnCount} columns</span>
              {table.estimatedRowCount !== undefined && (
                <span>~{table.estimatedRowCount.toLocaleString()} rows</span>
              )}
            </div>
            {table.primaryKey.length > 0 && (
              <div className="mt-2 text-xs text-slate-500">
                PK: {table.primaryKey.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
