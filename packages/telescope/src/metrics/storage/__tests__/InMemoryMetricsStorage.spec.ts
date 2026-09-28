import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryMetricsStorage } from '../InMemoryMetricsStorage';
import type { MetricPoint } from '../types';

const MINUTE = 60_000;

/** The start of the current minute, so points land in predictable buckets. */
const minute = (offset = 0) =>
	new Date(Math.floor(Date.now() / MINUTE) * MINUTE + offset * MINUTE);

function point(overrides: Partial<MetricPoint> = {}): MetricPoint {
	return {
		timestamp: minute(),
		projectId: 'shop',
		service: 'api',
		environment: 'production',
		name: 'http.request.duration',
		type: 'histogram',
		value: 10,
		labels: { route: '/users' },
		...overrides,
	};
}

const range = { start: minute(-10), end: minute(10) };

describe('InMemoryMetricsStorage', () => {
	let storage: InMemoryMetricsStorage;

	afterEach(async () => {
		await storage?.close();
		vi.useRealTimers();
	});

	it('aggregates points in the same minute into one bucket', async () => {
		storage = new InMemoryMetricsStorage({ flushInterval: 0 });

		await storage.write([
			point({ value: 10 }),
			point({ value: 30 }),
			point({ value: 20 }),
		]);

		const bucket = await storage.getBucket(
			'shop',
			'http.request.duration',
			minute(),
		);
		expect(bucket).toMatchObject({
			count: 3,
			sum: 60,
			min: 10,
			max: 30,
			labels: { route: '/users' },
			labelsHash: 'route=/users',
		});
	});

	it('keys unlabelled points under one hash', async () => {
		storage = new InMemoryMetricsStorage({ flushInterval: 0 });

		await storage.write([point({ labels: {} }), point({ labels: {} })]);

		const bucket = await storage.getBucket(
			'shop',
			'http.request.duration',
			minute(),
		);
		expect(bucket?.labelsHash).toBe('_empty_');
		expect(bucket?.count).toBe(2);
	});

	it('answers null for a bucket that was never written', async () => {
		storage = new InMemoryMetricsStorage({ flushInterval: 0 });

		expect(await storage.getBucket('shop', 'nothing', minute())).toBeNull();
	});

	it('flushes on its own once a batch is full', async () => {
		storage = new InMemoryMetricsStorage({
			flushInterval: 0,
			maxBatchSize: 2,
			autoRollup: false,
		});

		await storage.write([point({ value: 1 }), point({ value: 2 })]);

		// Read the bucket without going through query/getBucket's own flush.
		const buckets = (
			storage as unknown as { buckets: Map<string, { count: number }> }
		).buckets;
		expect([...buckets.values()][0]?.count).toBe(2);
	});

	it('flushes on the configured interval', async () => {
		vi.useFakeTimers();
		storage = new InMemoryMetricsStorage({ flushInterval: 1000 });

		await storage.write([point()]);
		const buckets = (storage as unknown as { buckets: Map<string, unknown> })
			.buckets;
		expect(buckets.size).toBe(0);

		await vi.advanceTimersByTimeAsync(1000);
		expect(buckets.size).toBe(1);
	});

	describe('query', () => {
		it('returns stats and a time series over the range', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write([
				point({ value: 10 }),
				point({ value: 20 }),
				point({ value: 30, timestamp: minute(1) }),
			]);

			const [result] = await storage.query({
				projectId: 'shop',
				range: { start: minute(), end: minute(5) },
			});

			expect(result?.stats).toMatchObject({
				count: 3,
				sum: 60,
				avg: 20,
				min: 10,
				max: 30,
			});
			expect(result?.timeSeries.map((p) => p.count)).toEqual([2, 1]);
			expect(result?.timeSeries[0]).toMatchObject({ avg: 15, min: 10 });
		});

		it('computes percentiles from the samples', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write(
				Array.from({ length: 100 }, (_, i) => point({ value: i + 1 })),
			);

			const [result] = await storage.query({ projectId: 'shop', range });

			expect(result?.stats).toMatchObject({ p50: 50, p95: 95, p99: 99 });
		});

		it('keeps sampling a bucket past its reservoir without growing it', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write(
				Array.from({ length: 1500 }, (_, i) => point({ value: i })),
			);

			const samples = (storage as unknown as { samples: Map<string, number[]> })
				.samples;
			expect([...samples.values()][0]).toHaveLength(1000);
			const [result] = await storage.query({ projectId: 'shop', range });
			expect(result?.stats.count).toBe(1500);
		});

		it('fills the gaps in a series with zeros, not infinities', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write([point({ timestamp: minute(2) })]);

			const [result] = await storage.query({
				projectId: 'shop',
				range: { start: minute(), end: minute(5) },
			});

			expect(result?.timeSeries[0]).toMatchObject({ count: 0, min: 0, max: 0 });
			expect(result?.timeSeries[2]?.count).toBe(1);
		});

		it('filters by project, service, environment, name and labels', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write([
				point(),
				point({ projectId: 'other' }),
				point({ service: 'worker' }),
				point({ environment: 'staging' }),
				point({ name: 'orders.created' }),
				point({ labels: { route: '/orders' } }),
			]);

			const [result] = await storage.query({
				projectId: 'shop',
				service: 'api',
				environment: 'production',
				name: 'http.request.duration',
				labels: { route: '/users' },
				range,
			});

			expect(result?.stats.count).toBe(1);
		});

		it('matches names with a wildcard', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write([
				point({ name: 'http.request.duration' }),
				point({ name: 'http.request.size' }),
				point({ name: 'orders.created' }),
			]);

			const results = await storage.query({
				projectId: 'shop',
				name: 'http.*',
				range,
			});

			expect(results.map((r) => r.name).sort()).toEqual([
				'http.request.duration',
				'http.request.size',
			]);
		});

		it('leaves out buckets outside the range', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write([point({ timestamp: minute(-30) })]);

			expect(await storage.query({ projectId: 'shop', range })).toEqual([]);
		});

		it('groups by label, keeping only the grouped labels', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write([
				point({ labels: { route: '/users', method: 'GET' } }),
				point({ labels: { route: '/users', method: 'POST' } }),
				point({ labels: { route: '/orders', method: 'GET' } }),
				point({ labels: { method: 'GET' } }),
			]);

			const results = await storage.query({
				projectId: 'shop',
				groupBy: ['route'],
				range,
			});

			expect(results.map((r) => [r.labels, r.stats.count]).sort()).toEqual(
				[
					[{ route: '/users' }, 2],
					[{ route: '/orders' }, 1],
					[{}, 1],
				].sort(),
			);
		});

		it('returns at most the limit', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write([
				point({ name: 'a' }),
				point({ name: 'b' }),
				point({ name: 'c' }),
			]);

			const results = await storage.query({
				projectId: 'shop',
				range,
				limit: 2,
			});

			expect(results).toHaveLength(2);
		});
	});

	describe('prune', () => {
		it('drops buckets older than the shortest retention', async () => {
			storage = new InMemoryMetricsStorage({
				flushInterval: 0,
				autoRollup: false,
			});
			await storage.write([
				point({ timestamp: minute(-120) }),
				point({ timestamp: minute() }),
			]);
			await storage.flush();

			// The raw tier keeps an hour.
			expect(await storage.prune()).toBe(1);
			const [result] = await storage.query({
				projectId: 'shop',
				range: { start: minute(-180), end: minute(5) },
			});
			expect(result?.stats.count).toBe(1);
		});

		it('keeps everything when every tier keeps forever', async () => {
			storage = new InMemoryMetricsStorage({
				flushInterval: 0,
				autoRollup: false,
				tiers: [
					{
						name: 'all',
						interval: '1h',
						retention: 0,
						partitionInterval: 'monthly',
					},
				],
			});
			await storage.write([point({ timestamp: minute(-120) })]);
			await storage.flush();

			expect(await storage.prune()).toBe(0);
		});

		it('prunes after every flush when auto-rollup is on', async () => {
			storage = new InMemoryMetricsStorage({ flushInterval: 0 });
			await storage.write([point({ timestamp: minute(-120) })]);
			await storage.flush();

			expect(
				await storage.getBucket('shop', 'http.request.duration', minute(-120)),
			).toBeNull();
		});
	});

	it('needs no rollup or partitions', async () => {
		storage = new InMemoryMetricsStorage({ flushInterval: 0 });

		expect(
			await storage.rollup({ from: 'raw', to: '1h', olderThan: new Date() }),
		).toBe(0);
		expect(await storage.listPartitions()).toEqual([]);
	});

	it('merges its config over the defaults', () => {
		storage = new InMemoryMetricsStorage({ flushInterval: 0, maxBatchSize: 5 });

		expect(storage.getConfig()).toMatchObject({
			flushInterval: 0,
			maxBatchSize: 5,
			autoRollup: true,
		});
	});

	it('flushes and forgets everything on close', async () => {
		vi.useFakeTimers();
		storage = new InMemoryMetricsStorage({ flushInterval: 1000 });
		await storage.write([point()]);

		await storage.close();

		expect(
			await storage.getBucket('shop', 'http.request.duration', minute()),
		).toBeNull();
		// The interval is gone, so nothing fires after close.
		expect(vi.getTimerCount()).toBe(0);
	});
});
