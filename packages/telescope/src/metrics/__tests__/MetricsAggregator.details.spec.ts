import { describe, expect, it } from 'vitest';
import type { RequestEntry } from '../../types';
import { MetricsAggregator } from '../MetricsAggregator';

const MINUTE = 60_000;
const start = Math.floor(Date.now() / MINUTE) * MINUTE;

function request(overrides: Partial<RequestEntry> = {}): RequestEntry {
	return {
		id: `req-${Math.random().toString(36).slice(2)}`,
		method: 'GET',
		path: '/orders',
		url: 'http://localhost/orders',
		headers: {},
		query: {},
		status: 200,
		responseHeaders: {},
		duration: 10,
		timestamp: new Date(start),
		...overrides,
	};
}

const range = {
	start: new Date(start - 10 * MINUTE),
	end: new Date(start + 10 * MINUTE),
};

describe('MetricsAggregator.getEndpointDetails', () => {
	it('has nothing to say about an endpoint it never saw', () => {
		expect(
			new MetricsAggregator().getEndpointDetails('GET', '/nope'),
		).toBeNull();
	});

	it('breaks an endpoint down by status, time and percentile', () => {
		const aggregator = new MetricsAggregator();
		for (const [status, duration, offset] of [
			[200, 10, 0],
			[204, 20, 0],
			[301, 30, 1],
			[404, 40, 1],
			[503, 50, 2],
		] as const) {
			aggregator.record(
				request({
					status,
					duration,
					timestamp: new Date(start + offset * MINUTE),
				}),
			);
		}
		// A different endpoint, which must not leak in.
		aggregator.record(request({ path: '/users', status: 500 }));

		const details = aggregator.getEndpointDetails('GET', '/orders', {
			range,
		});

		expect(details).toMatchObject({
			method: 'GET',
			path: '/orders',
			count: 5,
			avgDuration: 30,
			p50Duration: 30,
			errorRate: 40,
			successRate: 60,
			statusDistribution: { '2xx': 2, '3xx': 1, '4xx': 1, '5xx': 1 },
		});
		expect(details?.timeSeries.map((p) => [p.count, p.errorCount])).toEqual([
			[2, 0],
			[2, 1],
			[1, 1],
		]);
	});

	it('leaves out time buckets outside the range', () => {
		const aggregator = new MetricsAggregator();
		aggregator.record(request({ timestamp: new Date(start - 60 * MINUTE) }));

		const details = aggregator.getEndpointDetails('GET', '/orders', {
			range,
		});

		expect(details?.count).toBe(1);
		expect(details?.timeSeries).toEqual([]);
	});

	it('interpolates percentiles between samples', () => {
		const aggregator = new MetricsAggregator();
		for (const duration of [10, 20]) {
			aggregator.record(request({ duration }));
		}

		const details = aggregator.getEndpointDetails('GET', '/orders', {
			range,
		});

		expect(details?.p50Duration).toBe(15);
		expect(details?.p99Duration).toBeCloseTo(19.9);
	});
});

describe('MetricsAggregator time series', () => {
	it('re-buckets into a coarser size, weighting the average', () => {
		const aggregator = new MetricsAggregator();
		const hour = Math.floor(start / (60 * MINUTE)) * 60 * MINUTE;
		aggregator.record(request({ duration: 10, timestamp: new Date(hour) }));
		aggregator.record(request({ duration: 10, timestamp: new Date(hour) }));
		aggregator.record(
			request({
				duration: 40,
				status: 500,
				timestamp: new Date(hour + MINUTE),
			}),
		);

		const { timeSeries } = aggregator.getMetrics({
			range: { start: new Date(hour), end: new Date(hour + 5 * MINUTE) },
			bucketSize: 5 * MINUTE,
		});

		expect(timeSeries).toEqual([
			{ timestamp: hour, count: 3, avgDuration: 20, errorCount: 1 },
		]);
	});

	it('counts every status class in the overall distribution', () => {
		const aggregator = new MetricsAggregator();
		for (const status of [200, 302, 418, 500]) {
			aggregator.record(request({ status }));
		}

		expect(aggregator.getStatusDistribution({ range })).toEqual({
			'2xx': 1,
			'3xx': 1,
			'4xx': 1,
			'5xx': 1,
		});
	});
});

describe('MetricsAggregator limits', () => {
	it('keeps sampling once a bucket holds its maximum', () => {
		const aggregator = new MetricsAggregator({ maxSamplesPerBucket: 5 });
		for (let i = 0; i < 50; i++) {
			aggregator.record(request({ duration: i }));
		}

		const metrics = aggregator.getMetrics({ range });
		const details = aggregator.getEndpointDetails('GET', '/orders', { range });

		expect(metrics.totalRequests).toBe(50);
		expect(details?.count).toBe(50);
		// Percentiles come from at most five samples, all real durations.
		expect(details?.p50Duration).toBeGreaterThanOrEqual(0);
		expect(details?.p50Duration).toBeLessThan(50);
	});

	it("drops an endpoint's oldest time buckets past the maximum", () => {
		const aggregator = new MetricsAggregator({ maxBuckets: 2 });
		for (let i = 0; i < 4; i++) {
			aggregator.record(
				request({ timestamp: new Date(start - (3 - i) * MINUTE) }),
			);
		}

		const details = aggregator.getEndpointDetails('GET', '/orders', {
			range,
		});

		expect(details?.timeSeries).toHaveLength(2);
		expect(details?.timeSeries[0]?.timestamp).toBe(start - MINUTE);
	});
});
