import { ConnectionStatus, Header, HeaderActions, HeaderTitle } from '@geekmidas/ui';
import { Database, RefreshCw } from 'lucide-react';
import { useStudio } from '../providers/StudioProvider';

export function StudioHeader() {
  const { connected, stats, loading, refresh } = useStudio();

  return (
    <Header>
      <HeaderTitle>
        <Database className="h-5 w-5 text-accent" />
        <span>Dev Studio</span>
      </HeaderTitle>

      <HeaderActions>
        {stats && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{stats.requests}</span>{' '}
              requests
            </span>
            <span>
              <span className="font-medium text-foreground">{stats.exceptions}</span>{' '}
              exceptions
            </span>
            <span>
              <span className="font-medium text-foreground">{stats.logs}</span>{' '}
              logs
            </span>
          </div>
        )}

        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-surface-hover hover:bg-surface-hover/80 rounded transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        <ConnectionStatus
          status={connected ? 'connected' : 'disconnected'}
          size="sm"
        />
      </HeaderActions>
    </Header>
  );
}
