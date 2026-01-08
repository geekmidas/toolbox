import type { MetricsStorage } from './MetricsStorage';
import {
	type AggregationInterval,
	DEFAULT_METRICS_CONFIG,
	type MetricBucket,
	type MetricLabels,
	type MetricPoint,
	type MetricQuery,
	type MetricResult,
	type MetricsStorageConfig,
	type PartitionInfo,
	type RollupOptions,
} from './types';

/**
 * In-memory metrics storage for development and testing.
 *
 * Features:
 * - Buffered writes with configurable flush interval
 * - Time-bucketed aggregation
 * - Basic percentile calculation (reservoir sampling)
 * - Automatic pruning based on retention
 *
 * Not suitable for production - use a proper time-series database.
 */
export class InMemoryMetricsStorage implements MetricsStorage {
	private config: MetricsStorageConfig;
	private buffer: MetricPoint[] = [];
	private buckets: Map<string, MetricBucket> = new Map();
	private samples: Map<string, number[]> = new Map(); // For percentile calculations
	private flushTimer: ReturnType<typeof setInterval> | null = null;

	constructor(config: Partial<MetricsStorageConfig> = {}) {
		this.config = { ...DEFAULT_METRICS_CONFIG, ...config };

		if (this.config.flushInterval > 0) {
			this.flushTimer = setInterval(() => {
				this.flush().catch(console.error);
			}, this.config.flushInterval);
		}
	}

	async write(points: MetricPoint[]): Promise<void> {
		this.buffer.push(...points);

		if (this.buffer.length >= this.config.maxBatchSize) {
			await this.flush();
		}
	}

	async flush(): Promise<void> {
		if (this.buffer.length === 0) return;

		const points = this.buffer.splice(0);

		for (const point of points) {
			this.aggregatePoint(point);
		}

		// Prune if auto-rollup is enabled
		if (this.config.autoRollup) {
			await this.prune();
		}
	}

	private aggregatePoint(point: MetricPoint): void {
		const bucketTime = this.getBucketTime(point.timestamp, '1m');
		const key = this.getBucketKey(point, bucketTime);

		const existing = this.buckets.get(key);

		if (existing) {
			existing.count += 1;
			existing.sum += point.value;
			existing.min = Math.min(existing.min, point.value);
			existing.max = Math.max(existing.max, point.value);
		} else {
			this.buckets.set(key, {
				bucket: bucketTime,
				projectId: point.projectId,
				service: point.service,
				environment: point.environment,
				name: point.name,
				labelsHash: this.hashLabels(point.labels),
				labels: { ...point.labels },
				count: 1,
				sum: point.value,
				min: point.value,
				max: point.value,
			});
		}

		// Store samples for percentile calculations (reservoir sampling)
		const sampleKey = `${point.projectId}:${point.name}:${bucketTime.getTime()}`;
		const samples = this.samples.get(sampleKey) ?? [];
		if (samples.length < 1000) {
			samples.push(point.value);
		} else {
			// Reservoir sampling
			const idx = Math.floor(Math.random() * (samples.length + 1));
			if (idx < samples.length) {
				samples[idx] = point.value;
			}
		}
		this.samples.set(sampleKey, samples);
	}

	async query(query: MetricQuery): Promise<MetricResult[]> {
		await this.flush();

		const results = new Map<string, MetricResult>();
		const startTime = query.range.start.getTime();
		const endTime = query.range.end.getTime();
		const interval = query.interval ?? '1m';
		const intervalMs = this.getIntervalMs(interval);

		for (const [, bucket] of this.buckets) {
			if (bucket.projectId !== query.projectId) continue;
			if (query.service && bucket.service !== query.service) continue;
			if (query.environment && bucket.environment !== query.environment)
				continue;
			if (query.name && !this.matchesPattern(bucket.name, query.name)) continue;
			if (query.labels && !this.matchesLabels(bucket.labels, query.labels))
				continue;

			const bucketTime = bucket.bucket.getTime();
			if (bucketTime < startTime || bucketTime > endTime) continue;

			// Group by metric name + labels
			const groupKey = query.groupBy
				? this.getGroupKey(bucket, query.groupBy)
				: bucket.name;

			let result = results.get(groupKey);
			if (!result) {
				result = {
					name: bucket.name,
					labels: query.groupBy
						? this.filterLabels(bucket.labels, query.groupBy)
						: bucket.labels,
					timeSeries: [],
					stats: {
						count: 0,
						sum: 0,
						avg: 0,
						min: Infinity,
						max: -Infinity,
						p50: 0,
						p95: 0,
						p99: 0,
					},
				};
				results.set(groupKey, result);
			}

			// Aggregate into time series
			const tsIndex = Math.floor((bucketTime - startTime) / intervalMs);
			while (result.timeSeries.length <= tsIndex) {
				result.timeSeries.push({
					timestamp: new Date(
						startTime + result.timeSeries.length * intervalMs,
					),
					count: 0,
					sum: 0,
					avg: 0,
					min: Infinity,
					max: -Infinity,
				});
			}

			const tsPoint = result.timeSeries[tsIndex];
			if (tsPoint) {
				tsPoint.count += bucket.count;
				tsPoint.sum += bucket.sum;
				tsPoint.min = Math.min(tsPoint.min, bucket.min);
				tsPoint.max = Math.max(tsPoint.max, bucket.max);
				tsPoint.avg = tsPoint.sum / tsPoint.count;
			}

			// Update overall stats
			result.stats.count += bucket.count;
			result.stats.sum += bucket.sum;
			result.stats.min = Math.min(result.stats.min, bucket.min);
			result.stats.max = Math.max(result.stats.max, bucket.max);
		}

		// Calculate percentiles and finalize
		for (const result of results.values()) {
			if (result.stats.count > 0) {
				result.stats.avg = result.stats.sum / result.stats.count;

				// Gather all samples for this result
				const allSamples: number[] = [];
				for (const [key, samples] of this.samples) {
					if (key.startsWith(`${query.projectId}:${result.name}:`)) {
						allSamples.push(...samples);
					}
				}

				if (allSamples.length > 0) {
					allSamples.sort((a, b) => a - b);
					result.stats.p50 = this.percentile(allSamples, 50);
					result.stats.p95 = this.percentile(allSamples, 95);
					result.stats.p99 = this.percentile(allSamples, 99);
				}
			}

			// Fix infinity values
			if (result.stats.min === Infinity) result.stats.min = 0;
			if (result.stats.max === -Infinity) result.stats.max = 0;

			for (const point of result.timeSeries) {
				if (point.min === Infinity) point.min = 0;
				if (point.max === -Infinity) point.max = 0;
			}
		}

		const resultArray = Array.from(results.values());

		if (query.limit) {
			return resultArray.slice(0, query.limit);
		}

		return resultArray;
	}

	async getBucket(
		projectId: string,
		name: string,
		bucket: Date,
	): Promise<MetricBucket | null> {
		await this.flush();

		for (const [, b] of this.buckets) {
			if (
				b.projectId === projectId &&
				b.name === name &&
				b.bucket.getTime() === bucket.getTime()
			) {
				return b;
			}
		}

		return null;
	}

	async rollup(_options: RollupOptions): Promise<number> {
		// In-memory storage doesn't need rollup - data is already aggregated
		return 0;
	}

	async prune(): Promise<number> {
		const now = Date.now();
		let deleted = 0;

		// Use the shortest retention from tiers
		const retentionMs = Math.min(
			...this.config.tiers
				.filter((t) => t.retention > 0)
				.map((t) => t.retention),
		);

		if (retentionMs === Infinity) return 0;

		const cutoff = now - retentionMs;

		for (const [key, bucket] of this.buckets) {
			if (bucket.bucket.getTime() < cutoff) {
				this.buckets.delete(key);
				deleted++;
			}
		}

		// Also prune samples
		for (const [key] of this.samples) {
			const timestamp = parseInt(key.split(':').pop() ?? '0', 10);
			if (timestamp < cutoff) {
				this.samples.delete(key);
			}
		}

		return deleted;
	}

	async listPartitions(_tier?: string): Promise<PartitionInfo[]> {
		// In-memory storage doesn't use partitions
		return [];
	}

	getConfig(): MetricsStorageConfig {
		return this.config;
	}

	async close(): Promise<void> {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		await this.flush();
		this.buckets.clear();
		this.samples.clear();
	}

	// Helper methods

	private getBucketTime(timestamp: Date, interval: AggregationInterval): Date {
		const ms = this.getIntervalMs(interval);
		return new Date(Math.floor(timestamp.getTime() / ms) * ms);
	}

	private getBucketKey(point: MetricPoint, bucketTime: Date): string {
		return [
			point.projectId,
			point.service,
			point.environment,
			point.name,
			this.hashLabels(point.labels),
			bucketTime.getTime(),
		].join(':');
	}

	private hashLabels(labels: MetricLabels): string {
		const sorted = Object.keys(labels)
			.sort()
			.map((k) => `${k}=${labels[k]}`)
			.join(',');
		return sorted || '_empty_';
	}

	private getIntervalMs(interval: AggregationInterval): number {
		const map: Record<AggregationInterval, number> = {
			'1m': 60_000,
			'5m': 300_000,
			'15m': 900_000,
			'1h': 3_600_000,
			'6h': 21_600_000,
			'1d': 86_400_000,
		};
		return map[interval];
	}

	private matchesPattern(name: string, pattern: string): boolean {
		if (!pattern.includes('*')) return name === pattern;
		const regex = new RegExp(
			`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`,
		);
		return regex.test(name);
	}

	private matchesLabels(labels: MetricLabels, filter: MetricLabels): boolean {
		for (const [key, value] of Object.entries(filter)) {
			if (labels[key] !== value) return false;
		}
		return true;
	}

	private getGroupKey(bucket: MetricBucket, groupBy: string[]): string {
		const parts = [bucket.name];
		for (const key of groupBy) {
			parts.push(`${key}=${bucket.labels[key] ?? ''}`);
		}
		return parts.join(':');
	}

	private filterLabels(labels: MetricLabels, keys: string[]): MetricLabels {
		const result: MetricLabels = {};
		for (const key of keys) {
			if (labels[key] !== undefined) {
				result[key] = labels[key];
			}
		}
		return result;
	}

	private percentile(sorted: number[], p: number): number {
		if (sorted.length === 0) return 0;
		const index = Math.ceil((p / 100) * sorted.length) - 1;
		return sorted[Math.max(0, index)] ?? 0;
	}
}
