import type {
	MetricBucket,
	MetricPoint,
	MetricQuery,
	MetricResult,
	MetricsStorageConfig,
	PartitionInfo,
	RollupOptions,
} from './types';

/**
 * Interface for metrics storage backends.
 *
 * Implementations can use different storage technologies:
 * - In-memory (development/testing)
 * - PostgreSQL with TimescaleDB
 * - ClickHouse
 * - InfluxDB
 */
export interface MetricsStorage {
	/**
	 * Write raw metric points to storage.
	 * Points are typically buffered and flushed in batches.
	 */
	write(points: MetricPoint[]): Promise<void>;

	/**
	 * Query metrics with aggregation.
	 * Returns time series data with statistics.
	 */
	query(query: MetricQuery): Promise<MetricResult[]>;

	/**
	 * Get a single aggregated bucket for a specific time range.
	 * Useful for dashboards showing current values.
	 */
	getBucket(
		projectId: string,
		name: string,
		bucket: Date,
	): Promise<MetricBucket | null>;

	/**
	 * Roll up data from one tier to another.
	 * Aggregates fine-grained data into coarser buckets.
	 */
	rollup(options: RollupOptions): Promise<number>;

	/**
	 * Prune old data based on retention policies.
	 * Returns the number of records deleted.
	 */
	prune(): Promise<number>;

	/**
	 * List partitions for management and monitoring.
	 */
	listPartitions(tier?: string): Promise<PartitionInfo[]>;

	/**
	 * Get storage configuration.
	 */
	getConfig(): MetricsStorageConfig;

	/**
	 * Flush any buffered data to storage.
	 */
	flush(): Promise<void>;

	/**
	 * Close the storage connection and clean up resources.
	 */
	close(): Promise<void>;
}
