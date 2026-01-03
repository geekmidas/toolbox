import type {
  EndpointBucket,
  EndpointMetrics,
  MetricsBucket,
  MetricsQueryOptions,
  RequestEntry,
  RequestMetrics,
  StatusDistribution,
  TimeRange,
  TimeSeriesPoint,
} from '../types';

/**
 * Configuration for MetricsAggregator
 */
export interface MetricsAggregatorOptions {
  /** Bucket size in milliseconds (default: 60000 = 1 minute) */
  bucketSize?: number;
  /** Maximum number of buckets to retain (default: 1440 = 24 hours at 1 min buckets) */
  maxBuckets?: number;
  /** Maximum duration samples to keep per bucket for percentiles (default: 1000) */
  maxSamplesPerBucket?: number;
}

const DEFAULT_OPTIONS: Required<MetricsAggregatorOptions> = {
  bucketSize: 60_000, // 1 minute
  maxBuckets: 1440, // 24 hours
  maxSamplesPerBucket: 1000,
};

/**
 * In-memory metrics aggregator for Telescope.
 * Aggregates request data into time-bucketed metrics for efficient querying.
 */
export class MetricsAggregator {
  private options: Required<MetricsAggregatorOptions>;
  private buckets: Map<number, MetricsBucket> = new Map();
  private endpoints: Map<string, EndpointBucket> = new Map();

  constructor(options: MetricsAggregatorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Record a request for metrics aggregation
   */
  record(entry: RequestEntry): void {
    const timestamp = entry.timestamp.getTime();
    const bucketTs = this.getBucketTimestamp(timestamp);

    // Update time bucket
    this.updateBucket(bucketTs, entry);

    // Update endpoint metrics
    this.updateEndpoint(entry);

    // Prune old buckets
    this.pruneBuckets();
  }

  /**
   * Get aggregated request metrics
   */
  getMetrics(options: MetricsQueryOptions = {}): RequestMetrics {
    const range = options.range ?? this.getDefaultRange();
    const bucketSize = options.bucketSize ?? this.options.bucketSize;

    // Get buckets in range
    const bucketsInRange = this.getBucketsInRange(range);

    if (bucketsInRange.length === 0) {
      return this.emptyMetrics();
    }

    // Aggregate all durations for percentile calculations
    const allDurations: number[] = [];
    let totalRequests = 0;
    let totalDuration = 0;
    let totalErrors = 0;

    for (const bucket of bucketsInRange) {
      totalRequests += bucket.count;
      totalDuration += bucket.durationSum;
      totalErrors += bucket.errorCount;
      allDurations.push(...bucket.durationSamples);
    }

    // Calculate percentiles
    allDurations.sort((a, b) => a - b);
    const p50 = this.percentile(allDurations, 50);
    const p95 = this.percentile(allDurations, 95);
    const p99 = this.percentile(allDurations, 99);

    // Calculate rates
    const rangeMs = range.end.getTime() - range.start.getTime();
    const rangeSeconds = rangeMs / 1000;
    const avgDuration = totalRequests > 0 ? totalDuration / totalRequests : 0;
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    // Build time series (re-bucket if needed)
    const timeSeries = this.buildTimeSeries(bucketsInRange, range, bucketSize);

    return {
      totalRequests,
      avgDuration,
      p50Duration: p50,
      p95Duration: p95,
      p99Duration: p99,
      errorRate,
      successRate: 100 - errorRate,
      requestsPerSecond: rangeSeconds > 0 ? totalRequests / rangeSeconds : 0,
      timeSeries,
    };
  }

  /**
   * Get metrics for individual endpoints
   */
  getEndpointMetrics(options: MetricsQueryOptions = {}): EndpointMetrics[] {
    const limit = options.limit ?? 50;

    const results: EndpointMetrics[] = [];

    for (const [, bucket] of this.endpoints) {
      const avgDuration = bucket.count > 0 ? bucket.durationSum / bucket.count : 0;
      bucket.durationSamples.sort((a, b) => a - b);
      const p95 = this.percentile(bucket.durationSamples, 95);
      const errorRate = bucket.count > 0 ? (bucket.errorCount / bucket.count) * 100 : 0;

      results.push({
        method: bucket.method,
        path: bucket.path,
        count: bucket.count,
        avgDuration,
        p95Duration: p95,
        errorRate,
        lastSeen: bucket.lastSeen,
      });
    }

    // Sort by count descending
    results.sort((a, b) => b.count - a.count);

    return results.slice(0, limit);
  }

  /**
   * Get status code distribution
   */
  getStatusDistribution(options: MetricsQueryOptions = {}): StatusDistribution {
    const range = options.range ?? this.getDefaultRange();
    const bucketsInRange = this.getBucketsInRange(range);

    const distribution: StatusDistribution = {
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0,
    };

    for (const bucket of bucketsInRange) {
      distribution['2xx'] += bucket.statusDistribution['2xx'];
      distribution['3xx'] += bucket.statusDistribution['3xx'];
      distribution['4xx'] += bucket.statusDistribution['4xx'];
      distribution['5xx'] += bucket.statusDistribution['5xx'];
    }

    return distribution;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.buckets.clear();
    this.endpoints.clear();
  }

  // ============================================
  // Private Methods
  // ============================================

  private getBucketTimestamp(timestamp: number): number {
    return Math.floor(timestamp / this.options.bucketSize) * this.options.bucketSize;
  }

  private updateBucket(bucketTs: number, entry: RequestEntry): void {
    let bucket = this.buckets.get(bucketTs);

    if (!bucket) {
      bucket = this.createEmptyBucket(bucketTs);
      this.buckets.set(bucketTs, bucket);
    }

    bucket.count++;
    bucket.durationSum += entry.duration;
    bucket.durationMin = Math.min(bucket.durationMin, entry.duration);
    bucket.durationMax = Math.max(bucket.durationMax, entry.duration);

    // Keep samples for percentile calculations (with reservoir sampling if needed)
    if (bucket.durationSamples.length < this.options.maxSamplesPerBucket) {
      bucket.durationSamples.push(entry.duration);
    } else {
      // Reservoir sampling: replace random element
      const idx = Math.floor(Math.random() * bucket.count);
      if (idx < this.options.maxSamplesPerBucket) {
        bucket.durationSamples[idx] = entry.duration;
      }
    }

    // Update status distribution
    const isError = entry.status >= 400;
    if (isError) bucket.errorCount++;

    if (entry.status >= 200 && entry.status < 300) {
      bucket.statusDistribution['2xx']++;
    } else if (entry.status >= 300 && entry.status < 400) {
      bucket.statusDistribution['3xx']++;
    } else if (entry.status >= 400 && entry.status < 500) {
      bucket.statusDistribution['4xx']++;
    } else if (entry.status >= 500) {
      bucket.statusDistribution['5xx']++;
    }
  }

  private updateEndpoint(entry: RequestEntry): void {
    const key = `${entry.method}:${entry.path}`;
    let endpoint = this.endpoints.get(key);

    if (!endpoint) {
      endpoint = {
        method: entry.method,
        path: entry.path,
        count: 0,
        durationSum: 0,
        durationSamples: [],
        errorCount: 0,
        lastSeen: 0,
      };
      this.endpoints.set(key, endpoint);
    }

    endpoint.count++;
    endpoint.durationSum += entry.duration;
    endpoint.lastSeen = entry.timestamp.getTime();

    if (entry.status >= 400) {
      endpoint.errorCount++;
    }

    // Keep samples for percentiles
    if (endpoint.durationSamples.length < this.options.maxSamplesPerBucket) {
      endpoint.durationSamples.push(entry.duration);
    } else {
      const idx = Math.floor(Math.random() * endpoint.count);
      if (idx < this.options.maxSamplesPerBucket) {
        endpoint.durationSamples[idx] = entry.duration;
      }
    }
  }

  private createEmptyBucket(timestamp: number): MetricsBucket {
    return {
      timestamp,
      bucketSize: this.options.bucketSize,
      count: 0,
      durationSum: 0,
      durationMin: Infinity,
      durationMax: 0,
      durationSamples: [],
      errorCount: 0,
      statusDistribution: {
        '2xx': 0,
        '3xx': 0,
        '4xx': 0,
        '5xx': 0,
      },
    };
  }

  private pruneBuckets(): void {
    if (this.buckets.size <= this.options.maxBuckets) return;

    // Get sorted timestamps
    const timestamps = Array.from(this.buckets.keys()).sort((a, b) => a - b);

    // Remove oldest buckets
    const toRemove = timestamps.slice(0, timestamps.length - this.options.maxBuckets);
    for (const ts of toRemove) {
      this.buckets.delete(ts);
    }
  }

  private getDefaultRange(): TimeRange {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    return { start: oneHourAgo, end: now };
  }

  private getBucketsInRange(range: TimeRange): MetricsBucket[] {
    const startTs = range.start.getTime();
    const endTs = range.end.getTime();

    const results: MetricsBucket[] = [];
    for (const [ts, bucket] of this.buckets) {
      if (ts >= startTs && ts <= endTs) {
        results.push(bucket);
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  private buildTimeSeries(
    buckets: MetricsBucket[],
    range: TimeRange,
    targetBucketSize: number,
  ): TimeSeriesPoint[] {
    if (buckets.length === 0) return [];

    // If target bucket size matches, just convert
    if (targetBucketSize === this.options.bucketSize) {
      return buckets.map((b) => ({
        timestamp: b.timestamp,
        count: b.count,
        avgDuration: b.count > 0 ? b.durationSum / b.count : 0,
        errorCount: b.errorCount,
      }));
    }

    // Re-bucket into target size
    const points: Map<number, TimeSeriesPoint> = new Map();

    for (const bucket of buckets) {
      const targetTs =
        Math.floor(bucket.timestamp / targetBucketSize) * targetBucketSize;
      let point = points.get(targetTs);

      if (!point) {
        point = { timestamp: targetTs, count: 0, avgDuration: 0, errorCount: 0 };
        points.set(targetTs, point);
      }

      // Weighted average for duration
      const totalCount = point.count + bucket.count;
      if (totalCount > 0) {
        point.avgDuration =
          (point.avgDuration * point.count +
            (bucket.count > 0 ? bucket.durationSum / bucket.count : 0) * bucket.count) /
          totalCount;
      }
      point.count = totalCount;
      point.errorCount += bucket.errorCount;
    }

    return Array.from(points.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0]!;

    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) return sortedValues[lower]!;

    // Linear interpolation
    const weight = index - lower;
    const lowerVal = sortedValues[lower]!;
    const upperVal = sortedValues[upper]!;
    return lowerVal * (1 - weight) + upperVal * weight;
  }

  private emptyMetrics(): RequestMetrics {
    return {
      totalRequests: 0,
      avgDuration: 0,
      p50Duration: 0,
      p95Duration: 0,
      p99Duration: 0,
      errorRate: 0,
      successRate: 100,
      requestsPerSecond: 0,
      timeSeries: [],
    };
  }
}
