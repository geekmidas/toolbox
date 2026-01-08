import { NoData } from '@geekmidas/ui';
import { Database, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import { RowDetail } from '../components/RowDetail';
import type { ForeignKeyClickInfo } from '../components/TableView';
import { TableView } from '../components/TableView';
import type { FilterConfig, TableInfo, TableSummary } from '../types';

export function DatabasePage() {
	const { table: tableParam } = useParams<{ table: string }>();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();

	const [tables, setTables] = useState<TableSummary[]>([]);
	const [selectedTable, setSelectedTable] = useState<string | null>(
		tableParam || null,
	);
	const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
	const [selectedRow, setSelectedRow] = useState<Record<
		string,
		unknown
	> | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState('');
	const [initialFilters, setInitialFilters] = useState<FilterConfig[]>([]);

	// Parse filter from URL query params
	useEffect(() => {
		const filterColumn = searchParams.get('filterColumn');
		const filterValue = searchParams.get('filterValue');

		if (filterColumn && filterValue) {
			setInitialFilters([
				{
					column: filterColumn,
					operator: 'eq',
					value: filterValue,
				},
			]);
		} else {
			setInitialFilters([]);
		}
	}, [searchParams]);

	// Update selected table when URL param changes
	useEffect(() => {
		if (tableParam) {
			setSelectedTable(tableParam);
		}
	}, [tableParam]);

	// Load tables on mount
	useEffect(() => {
		async function loadTables() {
			try {
				const data = await api.getTables();
				setTables(data.tables);
				// Auto-select first table if none selected
				if (data.tables.length > 0 && !selectedTable) {
					const firstTable = data.tables[0].name;
					setSelectedTable(firstTable);
					navigate(`/database/${firstTable}`, { replace: true });
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to load tables');
			} finally {
				setLoading(false);
			}
		}
		loadTables();
	}, [navigate, selectedTable]);

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

	const handleSelectTable = useCallback(
		(tableName: string) => {
			setSelectedTable(tableName);
			setSelectedRow(null);
			navigate(`/database/${tableName}`);
		},
		[navigate],
	);

	const handleForeignKeyClick = useCallback(
		(info: ForeignKeyClickInfo) => {
			const valueStr = String(info.value);
			navigate(
				`/database/${info.targetTable}?filterColumn=${encodeURIComponent(info.targetColumn)}&filterValue=${encodeURIComponent(valueStr)}`,
			);
		},
		[navigate],
	);

	// Filter tables by search term
	const filteredTables = tables.filter((t) =>
		t.name.toLowerCase().includes(searchTerm.toLowerCase()),
	);

	return (
		<div className="flex h-full">
			{/* Table Sidebar */}
			<aside className="w-64 bg-surface border-r border-border flex flex-col shrink-0">
				<div className="p-3 border-b border-border">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<input
							type="text"
							placeholder="Search tables..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="w-full bg-background border border-border rounded px-3 py-1.5 pl-9 text-sm placeholder-muted-foreground focus:outline-none focus:border-accent"
						/>
					</div>
				</div>

				<div className="flex-1 overflow-auto">
					{loading && tables.length === 0 ? (
						<div className="p-4 text-center text-muted-foreground text-sm">
							Loading...
						</div>
					) : (
						<div className="py-1">
							{filteredTables.map((table) => (
								<button
									key={table.name}
									onClick={() => handleSelectTable(table.name)}
									className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
										selectedTable === table.name
											? 'bg-accent/10 text-accent'
											: 'text-foreground hover:bg-surface-hover'
									}`}
								>
									<Database className="h-4 w-4 shrink-0" />
									<span className="truncate">{table.name}</span>
									{table.estimatedRowCount !== undefined && (
										<span className="ml-auto text-xs text-muted-foreground">
											{table.estimatedRowCount.toLocaleString()}
										</span>
									)}
								</button>
							))}
						</div>
					)}
				</div>

				<div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
					<span>{tables.length} tables</span>
					<button
						onClick={handleRefresh}
						disabled={loading}
						className="hover:text-foreground transition-colors"
					>
						Refresh
					</button>
				</div>
			</aside>

			{/* Main Area */}
			<div className="flex-1 flex flex-col overflow-hidden">
				{error ? (
					<div className="flex-1 flex items-center justify-center text-red-400">
						<div className="text-center">
							<p>{error}</p>
						</div>
					</div>
				) : !selectedTable ? (
					<NoData
						title="Select a table"
						description="Choose a table from the sidebar to view its data."
					/>
				) : (
					<TableView
						tableName={selectedTable}
						tableInfo={tableInfo}
						onRowSelect={setSelectedRow}
						onForeignKeyClick={handleForeignKeyClick}
						initialFilters={initialFilters}
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
		</div>
	);
}
