import { RefreshCw } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useStudio } from '../providers/StudioProvider';

const PAGE_TITLES: Record<string, string> = {
	'/': 'Dashboard',
	'/database': 'Database',
	'/monitoring': 'Monitoring',
	'/monitoring/requests': 'Requests',
	'/monitoring/logs': 'Logs',
	'/monitoring/exceptions': 'Exceptions',
	'/performance': 'Performance',
};

function getPageTitle(pathname: string): string {
	// Exact match first
	if (PAGE_TITLES[pathname]) {
		return PAGE_TITLES[pathname];
	}

	// Check for partial matches (e.g., /database/users -> Database)
	for (const [path, title] of Object.entries(PAGE_TITLES)) {
		if (pathname.startsWith(path) && path !== '/') {
			return title;
		}
	}

	return 'Studio';
}

export function StudioHeader() {
	const { connected, stats, loading, refresh } = useStudio();
	const location = useLocation();
	const pageTitle = getPageTitle(location.pathname);

	return (
		<header className="flex items-center justify-between h-14 px-6 border-b border-white/[0.06] bg-[#0a0a0a]">
			{/* Page Title */}
			<div className="flex items-center gap-3">
				<h1 className="text-[15px] font-semibold text-white">{pageTitle}</h1>
			</div>

			{/* Right side: Stats + Actions */}
			<div className="flex items-center gap-6">
				{/* Stats */}
				{stats && (
					<div className="flex items-center gap-5 text-[13px]">
						<div className="flex items-center gap-1.5">
							<span className="text-white/40">Requests</span>
							<span className="font-medium text-white tabular-nums">
								{stats.requests.toLocaleString()}
							</span>
						</div>
						<div className="flex items-center gap-1.5">
							<span className="text-white/40">Exceptions</span>
							<span
								className={`font-medium tabular-nums ${stats.exceptions > 0 ? 'text-red-400' : 'text-white'}`}
							>
								{stats.exceptions.toLocaleString()}
							</span>
						</div>
						<div className="flex items-center gap-1.5">
							<span className="text-white/40">Logs</span>
							<span className="font-medium text-white tabular-nums">
								{stats.logs.toLocaleString()}
							</span>
						</div>
					</div>
				)}

				{/* Divider */}
				<div className="h-4 w-px bg-white/[0.08]" />

				{/* Refresh Button */}
				<button
					onClick={refresh}
					disabled={loading}
					className="
            flex items-center gap-2 px-3 py-1.5
            text-[13px] font-medium
            text-white/70 hover:text-white
            bg-white/[0.04] hover:bg-white/[0.08]
            border border-white/[0.08] hover:border-white/[0.12]
            rounded-md transition-all
            disabled:opacity-50 disabled:cursor-not-allowed
          "
				>
					<RefreshCw
						className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
					/>
					Refresh
				</button>

				{/* Connection Status */}
				<div className="flex items-center gap-2">
					<span
						className={`
              h-2 w-2 rounded-full
              ${connected ? 'bg-emerald-500' : 'bg-red-500'}
            `}
					/>
					<span className="text-[13px] text-white/50">
						{connected ? 'Live' : 'Disconnected'}
					</span>
				</div>
			</div>
		</header>
	);
}
