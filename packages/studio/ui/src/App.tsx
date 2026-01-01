import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import { RowDetail } from './components/RowDetail';
import { TableList } from './components/TableList';
import { TableView } from './components/TableView';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Load tables on mount
  useEffect(() => {
    async function loadTables() {
      try {
        const data = await api.getTables();
        setTables(data.tables);
        // Auto-select first table if none selected
        if (data.tables.length > 0 && !selectedTable) {
          setSelectedTable(data.tables[0].name);
        }
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

  return (
    <div className="flex flex-col h-screen bg-studio-bg text-slate-100">
      {/* Header */}
      <header className="bg-studio-surface border-b border-studio-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 hover:bg-studio-hover rounded transition-colors"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              className="w-5 h-5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-emerald-400">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
            </span>
            Studio
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-studio-hover hover:bg-studio-active rounded transition-colors disabled:opacity-50"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`${sidebarCollapsed ? 'w-0' : 'w-64'} bg-studio-surface border-r border-studio-border flex flex-col shrink-0 transition-all duration-200 overflow-hidden`}
        >
          <div className="p-3 border-b border-studio-border">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search tables..."
                className="w-full bg-studio-bg border border-studio-border rounded px-3 py-1.5 pl-9 text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {loading && tables.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">
                Loading...
              </div>
            ) : (
              <TableList
                tables={tables}
                selectedTable={selectedTable}
                onSelect={handleSelectTable}
              />
            )}
          </div>
          <div className="p-3 border-t border-studio-border text-xs text-slate-500">
            {tables.length} tables
          </div>
        </aside>

        {/* Main Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {error ? (
            <div className="flex-1 flex items-center justify-center text-red-400">
              <div className="text-center">
                <svg
                  className="w-12 h-12 mx-auto mb-3 text-red-400/50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <p>{error}</p>
              </div>
            </div>
          ) : !selectedTable ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <svg
                  className="w-12 h-12 mx-auto mb-3 text-slate-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                  />
                </svg>
                <p>Select a table to view data</p>
              </div>
            </div>
          ) : (
            <TableView
              tableName={selectedTable}
              tableInfo={tableInfo}
              onRowSelect={setSelectedRow}
            />
          )}
        </div>

        {/* Row Detail Panel */}
        {selectedRow && tableInfo && (
          <RowDetail
            row={selectedRow}
            columns={tableInfo.columns}
            onClose={() => setSelectedRow(null)}
          />
        )}
      </main>
    </div>
  );
}
