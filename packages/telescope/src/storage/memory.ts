import type {
  ExceptionEntry,
  LogEntry,
  QueryOptions,
  RequestEntry,
  TelescopeStats,
  TelescopeStorage,
} from '../types';

export interface InMemoryStorageOptions {
  /** Maximum number of entries to keep per type (default: 1000) */
  maxEntries?: number;
}

/**
 * In-memory storage for Telescope data.
 * Ideal for development and testing.
 * Data is lost when the process restarts.
 */
export class InMemoryStorage implements TelescopeStorage {
  private requests: RequestEntry[] = [];
  private exceptions: ExceptionEntry[] = [];
  private logs: LogEntry[] = [];
  private maxEntries: number;

  constructor(options?: InMemoryStorageOptions) {
    this.maxEntries = options?.maxEntries ?? 1000;
  }

  // Requests

  async saveRequest(entry: RequestEntry): Promise<void> {
    this.requests.unshift(entry);
    this.enforceLimit('requests');
  }

  async saveRequests(entries: RequestEntry[]): Promise<void> {
    this.requests.unshift(...entries);
    this.enforceLimit('requests');
  }

  async getRequests(options?: QueryOptions): Promise<RequestEntry[]> {
    let result = this.requests;

    // Apply request-specific filters before generic filtering
    if (options?.method) {
      result = result.filter((r) => r.method === options.method);
    }

    if (options?.status) {
      const statusFilter = options.status;
      result = result.filter((r) => {
        // Handle status ranges like "2xx", "4xx", "5xx"
        if (statusFilter.endsWith('xx')) {
          const firstChar = statusFilter[0];
          if (!firstChar) return false;
          const category = parseInt(firstChar, 10);
          return Math.floor(r.status / 100) === category;
        }
        // Handle exact status codes
        return r.status === parseInt(statusFilter, 10);
      });
    }

    return this.filterEntries(result, options);
  }

  async getRequest(id: string): Promise<RequestEntry | null> {
    return this.requests.find((r) => r.id === id) ?? null;
  }

  // Exceptions

  async saveException(entry: ExceptionEntry): Promise<void> {
    this.exceptions.unshift(entry);
    this.enforceLimit('exceptions');
  }

  async saveExceptions(entries: ExceptionEntry[]): Promise<void> {
    this.exceptions.unshift(...entries);
    this.enforceLimit('exceptions');
  }

  async getExceptions(options?: QueryOptions): Promise<ExceptionEntry[]> {
    return this.filterEntries(this.exceptions, options);
  }

  async getException(id: string): Promise<ExceptionEntry | null> {
    return this.exceptions.find((e) => e.id === id) ?? null;
  }

  // Logs

  async saveLog(entry: LogEntry): Promise<void> {
    this.logs.unshift(entry);
    this.enforceLimit('logs');
  }

  async saveLogs(entries: LogEntry[]): Promise<void> {
    this.logs.unshift(...entries);
    this.enforceLimit('logs');
  }

  async getLogs(options?: QueryOptions): Promise<LogEntry[]> {
    let result = this.logs;

    // Apply log-specific filters before generic filtering
    if (options?.level) {
      result = result.filter((l) => l.level === options.level);
    }

    return this.filterEntries(result, options);
  }

  // Cleanup

  async prune(olderThan: Date): Promise<number> {
    const beforeCount =
      this.requests.length + this.exceptions.length + this.logs.length;

    this.requests = this.requests.filter((r) => r.timestamp >= olderThan);
    this.exceptions = this.exceptions.filter((e) => e.timestamp >= olderThan);
    this.logs = this.logs.filter((l) => l.timestamp >= olderThan);

    const afterCount =
      this.requests.length + this.exceptions.length + this.logs.length;
    return beforeCount - afterCount;
  }

  // Stats

  async getStats(): Promise<TelescopeStats> {
    const allTimestamps = [
      ...this.requests.map((r) => r.timestamp),
      ...this.exceptions.map((e) => e.timestamp),
      ...this.logs.map((l) => l.timestamp),
    ].sort((a, b) => a.getTime() - b.getTime());

    return {
      requests: this.requests.length,
      exceptions: this.exceptions.length,
      logs: this.logs.length,
      oldestEntry: allTimestamps[0],
      newestEntry: allTimestamps[allTimestamps.length - 1],
    };
  }

  // Clear all data (useful for testing)

  clear(): void {
    this.requests = [];
    this.exceptions = [];
    this.logs = [];
  }

  // Private helpers

  private enforceLimit(type: 'requests' | 'exceptions' | 'logs'): void {
    const entries = this[type];
    if (entries.length > this.maxEntries) {
      if (type === 'requests') {
        this.requests = this.requests.slice(0, this.maxEntries);
      } else if (type === 'exceptions') {
        this.exceptions = this.exceptions.slice(0, this.maxEntries);
      } else {
        this.logs = this.logs.slice(0, this.maxEntries);
      }
    }
  }

  private filterEntries<T extends { timestamp: Date; tags?: string[] }>(
    entries: T[],
    options?: QueryOptions,
  ): T[] {
    let result = entries;

    if (options?.after) {
      result = result.filter((e) => e.timestamp >= options.after!);
    }

    if (options?.before) {
      result = result.filter((e) => e.timestamp <= options.before!);
    }

    if (options?.tags && options.tags.length > 0) {
      result = result.filter(
        (e) => e.tags && options.tags!.some((t) => e.tags!.includes(t)),
      );
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      result = result.filter((e) => {
        const str = JSON.stringify(e).toLowerCase();
        return str.includes(searchLower);
      });
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;

    return result.slice(offset, offset + limit);
  }
}
