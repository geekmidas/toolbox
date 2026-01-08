import type { TableSummary } from '../types';

interface TableListProps {
	tables: TableSummary[];
	selectedTable: string | null;
	onSelect: (tableName: string) => void;
}

export function TableList({ tables, selectedTable, onSelect }: TableListProps) {
	if (tables.length === 0) {
		return (
			<div className="p-4 text-center text-slate-500 text-sm">
				<p>No tables found</p>
				<p className="mt-1 text-xs">Check your database schema.</p>
			</div>
		);
	}

	return (
		<div className="py-1">
			{tables.map((table) => (
				<button
					key={table.name}
					onClick={() => onSelect(table.name)}
					className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
						selectedTable === table.name
							? 'bg-studio-hover text-white'
							: 'text-slate-400 hover:bg-studio-hover hover:text-slate-200'
					}`}
				>
					{/* Table icon */}
					<svg
						className={`w-4 h-4 shrink-0 ${selectedTable === table.name ? 'text-emerald-400' : 'text-slate-500'}`}
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={1.5}
							d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>

					<div className="flex-1 min-w-0">
						<div className="truncate text-sm">{table.name}</div>
						{table.estimatedRowCount !== undefined && (
							<div className="text-xs text-slate-500">
								{table.estimatedRowCount.toLocaleString()} rows
							</div>
						)}
					</div>
				</button>
			))}
		</div>
	);
}
