import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import { TableList } from './components/TableList';
import { TableView } from './components/TableView';
import { RowDetail } from './components/RowDetail';
import type { TableInfo, TableSummary } from './types';

export function App() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [selectedRow, setSelectedRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load tables on mount
  useEffect(() => {
    async function loadTables() {
      try {
        const data = await api.getTables();
        setTables(data.tables);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tables');
      } finally {
        setLoading(false);
      }
    }
    loadTables();
  }, []);

  // Load table info when selected
  useEffect(() => {
    if (!selectedTable) {
      setTableInfo(null);
      return;
    }

    async function loadTableInfo() {
      try {
        const info = await api.getTableInfo(selectedTable!);
        setTableInfo(info);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load table info',
        );
      }
    }
    loadTableInfo();
  }, [selectedTable]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await api.getSchema(true);
      const data = await api.getTables();
      setTables(data.tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectTable = useCallback((tableName: string) => {
    setSelectedTable(tableName);
    setSelectedRow(null);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedTable(null);
    setTableInfo(null);
    setSelectedRow(null);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-bg-primary font-mono text-slate-100">
      {/* Header */}
      <header className="bg-bg-secondary border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {selectedTable && (
            <button
              onClick={handleBack}
              className="text-slate-400 hover:text-slate-100 transition-colors"
            >
              &larr; Back
            </button>
          )}
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <span className="text-purple-400">&#128451;</span> Studio
            {selectedTable && (
              <span className="text-slate-400">/ {selectedTable}</span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">{tables.length} tables</span>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-3 py-1 text-sm bg-bg-tertiary hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {error ? (
          <div className="flex-1 flex items-center justify-center text-red-400">
            {error}
          </div>
        ) : loading && tables.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            Loading...
          </div>
        ) : !selectedTable ? (
          <TableList tables={tables} onSelect={handleSelectTable} />
        ) : (
          <TableView
            tableName={selectedTable}
            tableInfo={tableInfo}
            onRowSelect={setSelectedRow}
          />
        )}
      </main>

      {/* Row Detail Panel */}
      {selectedRow && tableInfo && (
        <RowDetail
          row={selectedRow}
          columns={tableInfo.columns}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </div>
  );
}
