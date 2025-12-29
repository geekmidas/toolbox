import { nanoid } from 'nanoid';
import type {
  ExceptionEntry,
  LogEntry,
  NormalizedTelescopeOptions,
  QueryOptions,
  RequestEntry,
  StackFrame,
  TelescopeEvent,
  TelescopeOptions,
  TelescopeStorage,
} from './types';

/**
 * Framework-agnostic Telescope class for debugging and monitoring applications.
 * Use framework-specific adapters (e.g., @geekmidas/telescope/hono) for integration.
 */
export class Telescope {
  private storage: TelescopeStorage;
  private options: NormalizedTelescopeOptions;
  private wsClients = new Set<WebSocket>();
  private pruneInterval?: ReturnType<typeof setInterval>;

  constructor(options: TelescopeOptions) {
    this.storage = options.storage;
    this.options = this.normalizeOptions(options);

    // Set up auto-pruning if configured
    if (this.options.pruneAfterHours) {
      const intervalMs = 60 * 60 * 1000; // 1 hour
      this.pruneInterval = setInterval(() => {
        this.autoPrune().catch(console.error);
      }, intervalMs);
    }
  }

  // ============================================
  // Public API - Recording
  // ============================================

  /**
   * Record a request entry
   */
  async recordRequest(entry: Omit<RequestEntry, 'id' | 'timestamp'>): Promise<string> {
    if (!this.options.enabled) return '';

    const id = nanoid();
    const fullEntry: RequestEntry = {
      ...entry,
      id,
      timestamp: new Date(),
    };

    await this.storage.saveRequest(fullEntry);
    this.broadcast({ type: 'request', payload: fullEntry, timestamp: Date.now() });
    return id;
  }

  /**
   * Log entry input for batch operations
   */
  private async saveLogEntries(entries: LogEntry[]): Promise<void> {
    if (this.storage.saveLogs) {
      await this.storage.saveLogs(entries);
    } else {
      await Promise.all(entries.map((entry) => this.storage.saveLog(entry)));
    }

    for (const entry of entries) {
      this.broadcast({ type: 'log', payload: entry, timestamp: Date.now() });
    }
  }

  /**
   * Record log entries in batch.
   * More efficient than individual calls for database storage.
   *
   * @example
   * await telescope.log([
   *   { level: 'info', message: 'Request started' },
   *   { level: 'debug', message: 'Processing...', context: { step: 1 } },
   * ]);
   */
  async log(
    entries: Array<{
      level: 'debug' | 'info' | 'warn' | 'error';
      message: string;
      context?: Record<string, unknown>;
      requestId?: string;
    }>,
  ): Promise<void> {
    if (!this.options.enabled || entries.length === 0) return;

    const timestamp = new Date();
    const logEntries: LogEntry[] = entries.map((e) => ({
      id: nanoid(),
      level: e.level,
      message: e.message,
      context: e.context,
      requestId: e.requestId,
      timestamp,
    }));

    await this.saveLogEntries(logEntries);
  }

  /**
   * Log a debug message
   */
  async debug(
    message: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (!this.options.enabled) return;

    const entry: LogEntry = {
      id: nanoid(),
      level: 'debug',
      message,
      context,
      requestId,
      timestamp: new Date(),
    };

    await this.storage.saveLog(entry);
    this.broadcast({ type: 'log', payload: entry, timestamp: Date.now() });
  }

  /**
   * Log an info message
   */
  async info(
    message: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (!this.options.enabled) return;

    const entry: LogEntry = {
      id: nanoid(),
      level: 'info',
      message,
      context,
      requestId,
      timestamp: new Date(),
    };

    await this.storage.saveLog(entry);
    this.broadcast({ type: 'log', payload: entry, timestamp: Date.now() });
  }

  /**
   * Log a warning message
   */
  async warn(
    message: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (!this.options.enabled) return;

    const entry: LogEntry = {
      id: nanoid(),
      level: 'warn',
      message,
      context,
      requestId,
      timestamp: new Date(),
    };

    await this.storage.saveLog(entry);
    this.broadcast({ type: 'log', payload: entry, timestamp: Date.now() });
  }

  /**
   * Log an error message
   */
  async error(
    message: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (!this.options.enabled) return;

    const entry: LogEntry = {
      id: nanoid(),
      level: 'error',
      message,
      context,
      requestId,
      timestamp: new Date(),
    };

    await this.storage.saveLog(entry);
    this.broadcast({ type: 'log', payload: entry, timestamp: Date.now() });
  }

  /**
   * Record an exception
   */
  async exception(error: Error, requestId?: string): Promise<void> {
    if (!this.options.enabled) return;

    const stack = this.parseStack(error.stack || '');

    const entry: ExceptionEntry = {
      id: nanoid(),
      name: error.name,
      message: error.message,
      stack,
      requestId,
      timestamp: new Date(),
      handled: false,
    };

    await this.storage.saveException(entry);
    this.broadcast({
      type: 'exception',
      payload: entry,
      timestamp: Date.now(),
    });
  }

  // ============================================
  // Public API - Data Access
  // ============================================

  /**
   * Get requests from storage
   */
  async getRequests(options?: QueryOptions): Promise<RequestEntry[]> {
    return this.storage.getRequests(options);
  }

  /**
   * Get a single request by ID
   */
  async getRequest(id: string): Promise<RequestEntry | null> {
    return this.storage.getRequest(id);
  }

  /**
   * Get exceptions from storage
   */
  async getExceptions(options?: QueryOptions): Promise<ExceptionEntry[]> {
    return this.storage.getExceptions(options);
  }

  /**
   * Get a single exception by ID
   */
  async getException(id: string): Promise<ExceptionEntry | null> {
    return this.storage.getException(id);
  }

  /**
   * Get logs from storage
   */
  async getLogs(options?: QueryOptions): Promise<LogEntry[]> {
    return this.storage.getLogs(options);
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    return this.storage.getStats();
  }

  // ============================================
  // Public API - WebSocket
  // ============================================

  /**
   * Add a WebSocket client for real-time updates
   */
  addWsClient(ws: WebSocket): void {
    this.wsClients.add(ws);
    this.broadcast({
      type: 'connected',
      payload: { clientCount: this.wsClients.size },
      timestamp: Date.now(),
    });
  }

  /**
   * Remove a WebSocket client
   */
  removeWsClient(ws: WebSocket): void {
    this.wsClients.delete(ws);
  }

  /**
   * Broadcast an event to all connected WebSocket clients
   */
  broadcast(event: TelescopeEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.wsClients) {
      try {
        client.send(data);
      } catch {
        this.wsClients.delete(client);
      }
    }
  }

  // ============================================
  // Public API - Lifecycle
  // ============================================

  /**
   * Manually prune old entries
   */
  async prune(olderThan: Date): Promise<number> {
    return this.storage.prune(olderThan);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
    }
    this.wsClients.clear();
  }

  // ============================================
  // Public API - Configuration
  // ============================================

  /**
   * Get the telescope path
   */
  get path(): string {
    return this.options.path;
  }

  /**
   * Check if telescope is enabled
   */
  get enabled(): boolean {
    return this.options.enabled;
  }

  /**
   * Check if body recording is enabled
   */
  get recordBody(): boolean {
    return this.options.recordBody;
  }

  /**
   * Get max body size
   */
  get maxBodySize(): number {
    return this.options.maxBodySize;
  }

  /**
   * Check if a path should be ignored
   */
  shouldIgnore(path: string): boolean {
    // Always ignore telescope's own routes
    if (path.startsWith(this.options.path)) {
      return true;
    }

    return this.options.ignorePatterns.some((pattern) => {
      if (pattern.includes('*')) {
        const regex = new RegExp(
          '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        );
        return regex.test(path);
      }
      return path.startsWith(pattern);
    });
  }

  // ============================================
  // Public API - Dashboard
  // ============================================

  /**
   * Get the dashboard HTML
   */
  getDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telescope</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f23;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #333;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h1::before {
      content: '';
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
    }
    .stats {
      display: flex;
      gap: 24px;
      font-size: 14px;
      color: #888;
    }
    .stat-value {
      color: #fff;
      font-weight: 500;
    }
    nav {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
    }
    nav a {
      padding: 8px 16px;
      background: #1a1a3e;
      border-radius: 6px;
      color: #e0e0e0;
      text-decoration: none;
      font-size: 14px;
      transition: background 0.2s;
    }
    nav a:hover, nav a.active { background: #2a2a5e; }
    .panel {
      background: #1a1a3e;
      border-radius: 8px;
      overflow: hidden;
    }
    .entry {
      display: grid;
      grid-template-columns: 70px 1fr 100px 80px;
      gap: 16px;
      padding: 12px 16px;
      border-bottom: 1px solid #252550;
      align-items: center;
      cursor: pointer;
      transition: background 0.2s;
    }
    .entry:hover { background: #252550; }
    .method {
      font-weight: 600;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 4px;
      text-align: center;
    }
    .GET { background: #10b981; color: #fff; }
    .POST { background: #3b82f6; color: #fff; }
    .PUT { background: #f59e0b; color: #fff; }
    .PATCH { background: #8b5cf6; color: #fff; }
    .DELETE { background: #ef4444; color: #fff; }
    .path { font-family: monospace; font-size: 13px; }
    .status { font-family: monospace; }
    .status-2xx { color: #10b981; }
    .status-3xx { color: #3b82f6; }
    .status-4xx { color: #f59e0b; }
    .status-5xx { color: #ef4444; }
    .duration { color: #888; font-size: 13px; }
    .empty {
      padding: 48px;
      text-align: center;
      color: #666;
    }
    #entries { max-height: calc(100vh - 200px); overflow-y: auto; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Telescope</h1>
      <div class="stats">
        <span>Requests: <span class="stat-value" id="request-count">-</span></span>
        <span>Exceptions: <span class="stat-value" id="exception-count">-</span></span>
        <span>Logs: <span class="stat-value" id="log-count">-</span></span>
      </div>
    </header>

    <nav>
      <a href="#" class="active" data-view="requests">Requests</a>
      <a href="#" data-view="exceptions">Exceptions</a>
      <a href="#" data-view="logs">Logs</a>
    </nav>

    <div class="panel">
      <div id="entries"></div>
    </div>
  </div>

  <script>
    let currentView = 'requests';
    const basePath = window.location.pathname.replace(/\\/$/, '');

    async function fetchStats() {
      try {
        const res = await fetch(basePath + '/api/stats');
        const stats = await res.json();
        document.getElementById('request-count').textContent = stats.requests;
        document.getElementById('exception-count').textContent = stats.exceptions;
        document.getElementById('log-count').textContent = stats.logs;
      } catch (e) {
        console.error('Failed to fetch stats:', e);
      }
    }

    async function fetchData(type) {
      try {
        const res = await fetch(basePath + '/api/' + type);
        return await res.json();
      } catch (e) {
        console.error('Failed to fetch ' + type + ':', e);
        return [];
      }
    }

    function renderRequests(requests) {
      const container = document.getElementById('entries');
      if (requests.length === 0) {
        container.innerHTML = '<div class="empty">No requests recorded yet</div>';
        return;
      }
      container.innerHTML = requests.map(r => \`
        <div class="entry">
          <span class="method \${r.method}">\${r.method}</span>
          <span class="path">\${r.path}</span>
          <span class="status status-\${Math.floor(r.status/100)}xx">\${r.status}</span>
          <span class="duration">\${r.duration.toFixed(1)}ms</span>
        </div>
      \`).join('');
    }

    function renderExceptions(exceptions) {
      const container = document.getElementById('entries');
      if (exceptions.length === 0) {
        container.innerHTML = '<div class="empty">No exceptions recorded yet</div>';
        return;
      }
      container.innerHTML = exceptions.map(e => \`
        <div class="entry" style="grid-template-columns: 1fr 200px;">
          <div>
            <div style="color: #ef4444; font-weight: 500;">\${e.name}</div>
            <div style="font-size: 13px; color: #888; margin-top: 4px;">\${e.message}</div>
          </div>
          <span class="duration">\${new Date(e.timestamp).toLocaleTimeString()}</span>
        </div>
      \`).join('');
    }

    function renderLogs(logs) {
      const container = document.getElementById('entries');
      if (logs.length === 0) {
        container.innerHTML = '<div class="empty">No logs recorded yet</div>';
        return;
      }
      const levelColors = { debug: '#888', info: '#3b82f6', warn: '#f59e0b', error: '#ef4444' };
      container.innerHTML = logs.map(l => \`
        <div class="entry" style="grid-template-columns: 60px 1fr 100px;">
          <span style="color: \${levelColors[l.level]}; font-size: 12px; text-transform: uppercase;">\${l.level}</span>
          <span style="font-family: monospace; font-size: 13px;">\${l.message}</span>
          <span class="duration">\${new Date(l.timestamp).toLocaleTimeString()}</span>
        </div>
      \`).join('');
    }

    async function loadView(view) {
      currentView = view;
      document.querySelectorAll('nav a').forEach(a => {
        a.classList.toggle('active', a.dataset.view === view);
      });

      const data = await fetchData(view);
      if (view === 'requests') renderRequests(data);
      else if (view === 'exceptions') renderExceptions(data);
      else if (view === 'logs') renderLogs(data);
    }

    // Navigation
    document.querySelectorAll('nav a').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        loadView(a.dataset.view);
      });
    });

    // WebSocket for real-time updates
    function connectWs() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(protocol + '//' + location.host + basePath + '/ws');

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === currentView.slice(0, -1) ||
            (msg.type === 'request' && currentView === 'requests') ||
            (msg.type === 'exception' && currentView === 'exceptions') ||
            (msg.type === 'log' && currentView === 'logs')) {
          loadView(currentView);
        }
        fetchStats();
      };

      ws.onclose = () => {
        setTimeout(connectWs, 1000);
      };
    }

    // Initial load
    fetchStats();
    loadView('requests');
    connectWs();
  </script>
</body>
</html>`;
  }

  // ============================================
  // Private Methods
  // ============================================

  private normalizeOptions(
    options: TelescopeOptions,
  ): NormalizedTelescopeOptions {
    return {
      storage: options.storage,
      enabled: options.enabled ?? true,
      path: options.path ?? '/__telescope',
      recordBody: options.recordBody ?? true,
      maxBodySize: options.maxBodySize ?? 64 * 1024, // 64KB
      ignorePatterns: options.ignorePatterns ?? [],
      pruneAfterHours: options.pruneAfterHours,
    };
  }

  private parseStack(stack: string): StackFrame[] {
    const lines = stack.split('\n').slice(1);
    const frames: StackFrame[] = [];

    for (const line of lines) {
      // Match: "    at functionName (file:line:column)"
      // or: "    at file:line:column"
      const match =
        line.match(/at\s+(.+?)\s+\((.+):(\d+):(\d+)\)/) ||
        line.match(/at\s+(.+):(\d+):(\d+)/);

      if (match) {
        if (match.length === 5) {
          // Has function name
          frames.push({
            function: match[1],
            file: match[2],
            line: parseInt(match[3], 10),
            column: parseInt(match[4], 10),
            isApp: !match[2].includes('node_modules'),
          });
        } else if (match.length === 4) {
          // No function name
          frames.push({
            function: '<anonymous>',
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            isApp: !match[1].includes('node_modules'),
          });
        }
      }
    }

    return frames;
  }

  private async autoPrune(): Promise<void> {
    if (!this.options.pruneAfterHours) return;

    const olderThan = new Date(
      Date.now() - this.options.pruneAfterHours * 60 * 60 * 1000,
    );
    await this.storage.prune(olderThan);
  }
}
