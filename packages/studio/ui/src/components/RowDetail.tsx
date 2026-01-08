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
			return value ? 'text-emerald-400' : 'text-red-400';
		if (typeof value === 'number') return 'text-blue-400';
		return 'text-slate-300';
	};

	return (
		<aside className="w-96 bg-studio-surface border-l border-studio-border flex flex-col shrink-0 overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-studio-border shrink-0">
				<h2 className="text-sm font-medium text-slate-200">Row Details</h2>
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

			{/* Content */}
			<div className="flex-1 overflow-y-auto">
				{columns.map((col) => {
					const value = row[col.name];
					const isLongValue = typeof value === 'string' && value.length > 50;
					const isJson = typeof value === 'object' && value !== null;

					return (
						<div
							key={col.name}
							className="px-4 py-3 border-b border-studio-border"
						>
							{/* Column name and metadata */}
							<div className="flex items-center gap-2 mb-1.5">
								<span className="text-sm font-medium text-slate-300">
									{col.name}
								</span>
								<span className="text-xs text-slate-600">{col.rawType}</span>
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
							</div>

							{/* Value */}
							{isLongValue || isJson ? (
								<pre
									className={`${getValueClass(value)} bg-studio-bg text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-48`}
								>
									{formatValue(value)}
								</pre>
							) : (
								<div className={`text-sm ${getValueClass(value)}`}>
									{formatValue(value)}
								</div>
							)}

							{/* Foreign key reference */}
							{col.isForeignKey && col.foreignKeyTable && (
								<div className="mt-1.5 text-xs text-blue-400 flex items-center gap-1">
									<svg
										className="w-3 h-3"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
										/>
									</svg>
									{col.foreignKeyTable}.{col.foreignKeyColumn}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</aside>
	);
}
