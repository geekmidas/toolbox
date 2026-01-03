import { nanoid } from 'nanoid';
import { type Redactor, createRedactor } from './redact';
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
  private redactor?: Redactor;

  constructor(options: TelescopeOptions) {
    this.storage = options.storage;
    this.options = this.normalizeOptions(options);
    this.redactor = createRedactor(options.redact);

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
  async recordRequest(
    entry: Omit<RequestEntry, 'id' | 'timestamp'>,
  ): Promise<string> {
    if (!this.options.enabled) return '';

    const id = nanoid();
    let fullEntry: RequestEntry = {
      ...entry,
      id,
      timestamp: new Date(),
    };

    // Apply redaction if configured
    if (this.redactor) {
      fullEntry = this.redactor(fullEntry);
    }

    await this.storage.saveRequest(fullEntry);
    this.broadcast({
      type: 'request',
      payload: fullEntry,
      timestamp: Date.now(),
    });
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
    const logEntries: LogEntry[] = entries.map((e) => {
      const entry: LogEntry = {
        id: nanoid(),
        level: e.level,
        message: e.message,
        context: e.context,
        requestId: e.requestId,
        timestamp,
      };
      return this.redactor ? this.redactor(entry) : entry;
    });

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
    return this.logSingle('debug', message, context, requestId);
  }

  /**
   * Log an info message
   */
  async info(
    message: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    return this.logSingle('info', message, context, requestId);
  }

  /**
   * Log a warning message
   */
  async warn(
    message: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    return this.logSingle('warn', message, context, requestId);
  }

  /**
   * Log an error message
   */
  async error(
    message: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    return this.logSingle('error', message, context, requestId);
  }

  private async logSingle(
    level: LogEntry['level'],
    message: string,
    context?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    if (!this.options.enabled) return;

    let entry: LogEntry = {
      id: nanoid(),
      level,
      message,
      context,
      requestId,
      timestamp: new Date(),
    };

    if (this.redactor) {
      entry = this.redactor(entry);
    }

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
        if (
          match.length === 5 &&
          match[1] &&
          match[2] &&
          match[3] &&
          match[4]
        ) {
          // Has function name
          frames.push({
            function: match[1],
            file: match[2],
            line: parseInt(match[3], 10),
            column: parseInt(match[4], 10),
            isApp: !match[2].includes('node_modules'),
          });
        } else if (match.length === 4 && match[1] && match[2] && match[3]) {
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
