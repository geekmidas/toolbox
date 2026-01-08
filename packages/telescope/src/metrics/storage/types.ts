/**
 * Metric types supported by the storage system
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Labels/dimensions for metric filtering and grouping
 */
export type MetricLabels = Record<string, string>;

/**
 * A single metric data point
 */
export interface MetricPoint {
	/** Timestamp of the metric */
	timestamp: Date;
	/** Project/app identifier for multi-tenant isolation */
	projectId: string;
	/** Service name (e.g., 'api', 'worker', 'cron') */
	service: string;
	/** Environment (e.g., 'development', 'staging', 'production') */
	environment: string;
	/** Metric name (e.g., 'http.request.duration', 'orders.created') */
	name: string;
	/** Metric type */
	type: MetricType;
	/** Numeric value */
	value: number;
	/** Dimensions for filtering/grouping */
	labels: MetricLabels;
}

/**
 * Aggregated metric bucket (pre-computed for efficient queries)
 */
export interface MetricBucket {
	/** Bucket start timestamp */
	bucket: Date;
	/** Project identifier */
	projectId: string;
	/** Service name */
	service: string;
	/** Environment */
	environment: string;
	/** Metric name */
	name: string;
	/** Hash of labels for grouping */
	labelsHash: string;
	/** Original labels */
	labels: MetricLabels;
	/** Number of data points in bucket */
	count: number;
	/** Sum of values */
	sum: number;
	/** Minimum value */
	min: number;
	/** Maximum value */
	max: number;
	/** T-Digest sketch for percentile calculations (serialized) */
	sketch?: TDigestData;
}

/**
 * Serialized T-Digest data structure for percentile calculations
 * Stores centroids (mean, weight) that can be merged across buckets
 */
export interface TDigestData {
	/** Centroids: [mean, weight][] */
	centroids: [number, number][];
	/** Compression factor (higher = more accuracy, more memory) */
	compression: number;
	/** Total count of values */
	count: number;
	/** Minimum value seen */
	min: number;
	/** Maximum value seen */
	max: number;
}

/**
 * Time range for queries
 */
export interface TimeRange {
	start: Date;
	end: Date;
}

/**
 * Aggregation granularity
 */
export type AggregationInterval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d';

/**
 * Query parameters for retrieving metrics
 */
export interface MetricQuery {
	/** Project filter (required for multi-tenant) */
	projectId: string;
	/** Optional service filter */
	service?: string;
	/** Optional environment filter */
	environment?: string;
	/** Metric name pattern (supports wildcards like 'http.*') */
	name?: string;
	/** Label filters */
	labels?: MetricLabels;
	/** Time range */
	range: TimeRange;
	/** Aggregation interval */
	interval?: AggregationInterval;
	/** Group by these label keys */
	groupBy?: string[];
	/** Maximum number of results */
	limit?: number;
}

/**
 * Query result with aggregated values
 */
export interface MetricResult {
	/** Metric name */
	name: string;
	/** Labels (grouped by keys if specified) */
	labels: MetricLabels;
	/** Time series data points */
	timeSeries: MetricTimeSeriesPoint[];
	/** Overall statistics for the query range */
	stats: {
		count: number;
		sum: number;
		avg: number;
		min: number;
		max: number;
		p50: number;
		p95: number;
		p99: number;
	};
}

/**
 * Single point in a time series result
 */
export interface MetricTimeSeriesPoint {
	timestamp: Date;
	count: number;
	sum: number;
	avg: number;
	min: number;
	max: number;
	p50?: number;
	p95?: number;
	p99?: number;
}

/**
 * Storage tier configuration
 */
export interface StorageTier {
	/** Table/collection name for this tier */
	name: string;
	/** Bucket interval for aggregation */
	interval: AggregationInterval;
	/** Retention duration in milliseconds (0 = forever) */
	retention: number;
	/** Partition interval for efficient pruning */
	partitionInterval: 'hourly' | 'daily' | 'weekly' | 'monthly';
}

/**
 * Metrics storage configuration
 */
export interface MetricsStorageConfig {
	/** Storage tiers (raw, minute, hourly, etc.) */
	tiers: StorageTier[];
	/** Flush interval in milliseconds */
	flushInterval: number;
	/** Maximum batch size for writes */
	maxBatchSize: number;
	/** Enable automatic rollup between tiers */
	autoRollup: boolean;
	/** T-Digest compression factor (default: 100) */
	tdigestCompression: number;
}

/**
 * Default configuration with hybrid storage strategy
 */
export const DEFAULT_METRICS_CONFIG: MetricsStorageConfig = {
	tiers: [
		{
			name: 'raw',
			interval: '1m',
			retention: 60 * 60 * 1000, // 1 hour
			partitionInterval: 'hourly',
		},
		{
			name: '1m',
			interval: '1m',
			retention: 7 * 24 * 60 * 60 * 1000, // 7 days
			partitionInterval: 'daily',
		},
		{
			name: '1h',
			interval: '1h',
			retention: 0, // Forever
			partitionInterval: 'monthly',
		},
	],
	flushInterval: 10_000, // 10 seconds
	maxBatchSize: 1000,
	autoRollup: true,
	tdigestCompression: 100,
};

/**
 * Rollup options for aggregating data between tiers
 */
export interface RollupOptions {
	/** Source tier */
	from: string;
	/** Target tier */
	to: string;
	/** Only rollup data older than this */
	olderThan: Date;
}

/**
 * Partition info for management
 */
export interface PartitionInfo {
	/** Partition name */
	name: string;
	/** Tier this partition belongs to */
	tier: string;
	/** Partition start time */
	start: Date;
	/** Partition end time */
	end: Date;
	/** Approximate row count */
	rowCount?: number;
	/** Size in bytes */
	sizeBytes?: number;
}
