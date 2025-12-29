import type { LogEntry } from '../types';

interface LogDetailProps {
  log: LogEntry;
  onClose: () => void;
}

export function LogDetail({ log, onClose }: LogDetailProps) {
  const formatJson = (data: unknown) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const getLogLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      debug: 'bg-slate-500/20 text-slate-400',
      info: 'bg-blue-500/20 text-blue-400',
      warn: 'bg-amber-500/20 text-amber-400',
      error: 'bg-red-500/20 text-red-400',
    };
    return colors[level] || 'bg-slate-500/20 text-slate-400';
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 w-1/2 max-w-3xl bg-bg-secondary border-l border-border flex flex-col z-50 shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span
            className={`px-2 py-1 rounded text-xs ${getLogLevelColor(log.level)}`}
          >
            {log.level}
          </span>
          Log Entry
        </h2>
        <button
          className="text-slate-400 hover:text-slate-100 p-2 text-xl leading-none"
          onClick={onClose}
        >
          &times;
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
            Overview
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex py-2 border-b border-border">
              <span className="text-slate-500 min-w-32">Level</span>
              <span>{log.level}</span>
            </div>
            <div className="flex py-2 border-b border-border">
              <span className="text-slate-500 min-w-32">Timestamp</span>
              <span>{new Date(log.timestamp).toLocaleString()}</span>
            </div>
            {log.requestId && (
              <div className="flex py-2">
                <span className="text-slate-500 min-w-32">Request ID</span>
                <span className="font-mono text-xs">{log.requestId}</span>
              </div>
            )}
          </div>
        </section>

        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
            Message
          </h3>
          <pre className="bg-bg-primary border border-border rounded-lg p-4 overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
            {log.message}
          </pre>
        </section>

        {log.context && Object.keys(log.context).length > 0 && (
          <section className="mb-6">
            <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
              Context
            </h3>
            <pre className="bg-bg-primary border border-border rounded-lg p-4 overflow-x-auto text-xs leading-relaxed">
              {formatJson(log.context)}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
