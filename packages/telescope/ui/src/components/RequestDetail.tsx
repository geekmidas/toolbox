import type { RequestEntry } from '../types';

interface RequestDetailProps {
  request: RequestEntry;
  onClose: () => void;
}

export function RequestDetail({ request, onClose }: RequestDetailProps) {
  const formatJson = (data: unknown) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-green-500/20 text-green-400',
      POST: 'bg-blue-500/20 text-blue-400',
      PUT: 'bg-amber-500/20 text-amber-400',
      PATCH: 'bg-purple-500/20 text-purple-400',
      DELETE: 'bg-red-500/20 text-red-400',
    };
    return colors[method] || 'bg-slate-500/20 text-slate-400';
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 w-1/2 max-w-3xl bg-bg-secondary border-l border-border flex flex-col z-50 shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span
            className={`px-2 py-1 rounded text-xs ${getMethodColor(request.method)}`}
          >
            {request.method}
          </span>
          <span className="truncate">{request.path}</span>
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
              <span className="text-slate-500 min-w-32">Status</span>
              <span>{request.status}</span>
            </div>
            <div className="flex py-2 border-b border-border">
              <span className="text-slate-500 min-w-32">Duration</span>
              <span>{request.duration.toFixed(2)}ms</span>
            </div>
            <div className="flex py-2 border-b border-border">
              <span className="text-slate-500 min-w-32">URL</span>
              <span className="break-all">{request.url}</span>
            </div>
            <div className="flex py-2 border-b border-border">
              <span className="text-slate-500 min-w-32">Timestamp</span>
              <span>{new Date(request.timestamp).toLocaleString()}</span>
            </div>
            {request.ip && (
              <div className="flex py-2 border-b border-border">
                <span className="text-slate-500 min-w-32">IP</span>
                <span>{request.ip}</span>
              </div>
            )}
            {request.userId && (
              <div className="flex py-2 border-b border-border">
                <span className="text-slate-500 min-w-32">User ID</span>
                <span>{request.userId}</span>
              </div>
            )}
            {request.tags && request.tags.length > 0 && (
              <div className="flex py-2">
                <span className="text-slate-500 min-w-32">Tags</span>
                <span>{request.tags.join(', ')}</span>
              </div>
            )}
          </div>
        </section>

        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
            Request Headers
          </h3>
          <pre className="bg-bg-primary border border-border rounded-lg p-4 overflow-x-auto text-xs leading-relaxed">
            {formatJson(request.headers)}
          </pre>
        </section>

        {request.query && Object.keys(request.query).length > 0 && (
          <section className="mb-6">
            <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
              Query Parameters
            </h3>
            <pre className="bg-bg-primary border border-border rounded-lg p-4 overflow-x-auto text-xs leading-relaxed">
              {formatJson(request.query)}
            </pre>
          </section>
        )}

        {request.body !== undefined && (
          <section className="mb-6">
            <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
              Request Body
            </h3>
            <pre className="bg-bg-primary border border-border rounded-lg p-4 overflow-x-auto text-xs leading-relaxed">
              {formatJson(request.body)}
            </pre>
          </section>
        )}

        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
            Response Headers
          </h3>
          <pre className="bg-bg-primary border border-border rounded-lg p-4 overflow-x-auto text-xs leading-relaxed">
            {formatJson(request.responseHeaders)}
          </pre>
        </section>

        {request.responseBody !== undefined && (
          <section className="mb-6">
            <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
              Response Body
            </h3>
            <pre className="bg-bg-primary border border-border rounded-lg p-4 overflow-x-auto text-xs leading-relaxed">
              {formatJson(request.responseBody)}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
