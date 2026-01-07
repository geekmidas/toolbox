import type { Cache } from '@geekmidas/cache';
import type { AuditQueryOptions, AuditStorage } from './storage';
import type { AuditableAction, AuditRecord } from './types';

/**
 * Configuration for CacheAuditStorage.
 */
export interface CacheAuditStorageConfig {
  /** Cache instance to use for storage */
  cache: Cache;
  /**
   * Key prefix for audit records.
   * Records are stored as `${prefix}:${id}`.
   * @default 'audit'
   */
  prefix?: string;
  /**
   * TTL (time-to-live) in seconds for audit records.
   * If not set, records use the cache's default TTL.
   */
  ttl?: number;
}

/**
 * Cache-based audit storage implementation.
 * Uses any @geekmidas/cache implementation for storage.
 *
 * Best suited for:
 * - Development and testing
 * - Temporary audit logs that don't need persistence
 * - Applications with existing cache infrastructure
 * - Distributed systems needing shared audit state (with Redis/Upstash)
 *
 * Note: Query performance may degrade with large numbers of records
 * since filtering happens in memory after fetching all records.
 *
 * @template TAuditAction - Optional type parameter for type-safe audit actions.
 *
 * @example
 * ```typescript
 * import { CacheAuditStorage } from '@geekmidas/audit/cache';
 * import { InMemoryCache } from '@geekmidas/cache/memory';
 * import { UpstashCache } from '@geekmidas/cache/upstash';
 *
 * // With in-memory cache (development/testing)
 * const storage = new CacheAuditStorage({
 *   cache: new InMemoryCache(),
 *   ttl: 86400, // 24 hours
 * });
 *
 * // With Upstash Redis (production)
 * const storage = new CacheAuditStorage({
 *   cache: new UpstashCache({
 *     url: process.env.UPSTASH_REDIS_URL,
 *     token: process.env.UPSTASH_REDIS_TOKEN,
 *   }),
 *   ttl: 604800, // 7 days
 * });
 * ```
 */
export class CacheAuditStorage<
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> implements AuditStorage<TAuditAction>
{
  private readonly cache: Cache;
  private readonly prefix: string;
  private readonly ttl?: number;
  private readonly indexKey: string;

  constructor(config: CacheAuditStorageConfig) {
    this.cache = config.cache;
    this.prefix = config.prefix ?? 'audit';
    this.ttl = config.ttl;
    this.indexKey = `${this.prefix}:__index__`;
  }

  /**
   * Write audit records to cache.
   */
  async write(records: AuditRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    // Get existing index
    const existingIds = (await this.cache.get<string[]>(this.indexKey)) ?? [];
    const newIds: string[] = [];

    // Write each record
    for (const record of records) {
      const key = this.getRecordKey(record.id);
      // Serialize Date to ISO string for cache storage
      const serialized = this.serializeRecord(record);
      await this.cache.set(key, serialized, this.ttl);
      newIds.push(record.id);
    }

    // Update index with new IDs
    const updatedIds = [...existingIds, ...newIds];
    await this.cache.set(this.indexKey, updatedIds, this.ttl);
  }

  /**
   * Query audit records from cache.
   */
  async query(options: AuditQueryOptions): Promise<AuditRecord[]> {
    const allRecords = await this.getAllRecords();
    let results = this.applyFilters(allRecords, options);

    // Ordering
    const orderBy = options.orderBy ?? 'timestamp';
    const orderDirection = options.orderDirection ?? 'desc';
    results.sort((a, b) => {
      const aValue = orderBy === 'timestamp' ? a.timestamp.getTime() : a.type;
      const bValue = orderBy === 'timestamp' ? b.timestamp.getTime() : b.type;
      if (aValue < bValue) return orderDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return orderDirection === 'asc' ? 1 : -1;
      return 0;
    });

    // Pagination
    if (options.offset !== undefined) {
      results = results.slice(options.offset);
    }
    if (options.limit !== undefined) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Count audit records matching filters.
   */
  async count(
    options: Omit<AuditQueryOptions, 'limit' | 'offset'>,
  ): Promise<number> {
    const allRecords = await this.getAllRecords();
    return this.applyFilters(allRecords, options).length;
  }

  /**
   * Get all stored records (for testing/debugging).
   */
  async getRecords(): Promise<AuditRecord[]> {
    return this.getAllRecords();
  }

  /**
   * Clear all stored records.
   */
  async clear(): Promise<void> {
    const ids = (await this.cache.get<string[]>(this.indexKey)) ?? [];

    // Delete all records
    for (const id of ids) {
      await this.cache.delete(this.getRecordKey(id));
    }

    // Delete index
    await this.cache.delete(this.indexKey);
  }

  private getRecordKey(id: string): string {
    return `${this.prefix}:${id}`;
  }

  private async getAllRecords(): Promise<AuditRecord[]> {
    const ids = (await this.cache.get<string[]>(this.indexKey)) ?? [];
    const records: AuditRecord[] = [];
    const validIds: string[] = [];

    for (const id of ids) {
      const key = this.getRecordKey(id);
      const serialized = await this.cache.get<SerializedAuditRecord>(key);
      if (serialized) {
        records.push(this.deserializeRecord(serialized));
        validIds.push(id);
      }
    }

    // Clean up index if some records expired
    if (validIds.length !== ids.length) {
      await this.cache.set(this.indexKey, validIds, this.ttl);
    }

    return records;
  }

  private serializeRecord(record: AuditRecord): SerializedAuditRecord {
    return {
      ...record,
      timestamp: record.timestamp.toISOString(),
    };
  }

  private deserializeRecord(serialized: SerializedAuditRecord): AuditRecord {
    return {
      ...serialized,
      timestamp: new Date(serialized.timestamp),
    };
  }

  private applyFilters(
    records: AuditRecord[],
    options: AuditQueryOptions,
  ): AuditRecord[] {
    return records.filter((record) => {
      // Type filter
      if (options.type !== undefined) {
        if (Array.isArray(options.type)) {
          if (!options.type.includes(record.type)) return false;
        } else {
          if (record.type !== options.type) return false;
        }
      }

      // Entity ID filter
      if (options.entityId !== undefined) {
        const entityId =
          typeof options.entityId === 'string'
            ? options.entityId
            : JSON.stringify(options.entityId);
        const recordEntityId =
          typeof record.entityId === 'string'
            ? record.entityId
            : JSON.stringify(record.entityId);
        if (recordEntityId !== entityId) return false;
      }

      // Table filter
      if (options.table !== undefined) {
        if (record.table !== options.table) return false;
      }

      // Actor ID filter
      if (options.actorId !== undefined) {
        if (record.actor?.id !== options.actorId) return false;
      }

      // Date range filters
      if (options.from !== undefined) {
        if (record.timestamp < options.from) return false;
      }
      if (options.to !== undefined) {
        if (record.timestamp > options.to) return false;
      }

      return true;
    });
  }
}

/**
 * Serialized version of AuditRecord for cache storage.
 * Dates are stored as ISO strings.
 */
type SerializedAuditRecord = Omit<AuditRecord, 'timestamp'> & {
  timestamp: string;
};
