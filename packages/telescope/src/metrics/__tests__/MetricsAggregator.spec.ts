import { beforeEach, describe, expect, it } from 'vitest';
import type { RequestEntry } from '../../types';
import { MetricsAggregator } from '../MetricsAggregator';

function createRequest(overrides: Partial<RequestEntry> = {}): RequestEntry {
	return {
		id: `req-${Math.random().toString(36).slice(2)}`,
		method: 'GET',
		path: '/api/test',
		url: 'http://localhost/api/test',
		headers: {},
		query: {},
		status: 200,
		responseHeaders: {},
		duration: 50,
		timestamp: new Date(),
		...overrides,
	};
}

describe('MetricsAggregator', () => {
	let aggregator: MetricsAggregator;

	beforeEach(() => {
		aggregator = new MetricsAggregator();
	});

	describe('record', () => {
		it('should record a request', () => {
			const request = createRequest();
			aggregator.record(request);

			const metrics = aggregator.getMetrics();
			expect(metrics.totalRequests).toBe(1);
		});

		it('should aggregate multiple requests', () => {
			aggregator.record(createRequest({ duration: 100 }));
			aggregator.record(createRequest({ duration: 200 }));
			aggregator.record(createRequest({ duration: 300 }));

			const metrics = aggregator.getMetrics();
			expect(metrics.totalRequests).toBe(3);
			expect(metrics.avgDuration).toBe(200);
		});

		it('should track error requests', () => {
			aggregator.record(createRequest({ status: 200 }));
			aggregator.record(createRequest({ status: 404 }));
			aggregator.record(createRequest({ status: 500 }));
			aggregator.record(createRequest({ status: 200 }));

			const metrics = aggregator.getMetrics();
			expect(metrics.totalRequests).toBe(4);
			expect(metrics.errorRate).toBe(50); // 2 out of 4
			expect(metrics.successRate).toBe(50);
		});
	});

	describe('getMetrics', () => {
		it('should return empty metrics when no requests', () => {
			const metrics = aggregator.getMetrics();

			expect(metrics.totalRequests).toBe(0);
			expect(metrics.avgDuration).toBe(0);
			expect(metrics.p50Duration).toBe(0);
			expect(metrics.p95Duration).toBe(0);
			expect(metrics.p99Duration).toBe(0);
			expect(metrics.errorRate).toBe(0);
			expect(metrics.successRate).toBe(100);
			expect(metrics.requestsPerSecond).toBe(0);
			expect(metrics.timeSeries).toEqual([]);
		});

		it('should calculate percentiles correctly', () => {
			// Add 100 requests with durations 1-100ms
			for (let i = 1; i <= 100; i++) {
				aggregator.record(createRequest({ duration: i }));
			}

			const metrics = aggregator.getMetrics();

			// p50 should be around 50 (median of 1-100 is 50.5)
			expect(metrics.p50Duration).toBeGreaterThanOrEqual(49);
			expect(metrics.p50Duration).toBeLessThanOrEqual(52);
			// p95 should be around 95
			expect(metrics.p95Duration).toBeGreaterThanOrEqual(94);
			expect(metrics.p95Duration).toBeLessThanOrEqual(96);
			// p99 should be around 99
			expect(metrics.p99Duration).toBeGreaterThanOrEqual(98);
			expect(metrics.p99Duration).toBeLessThanOrEqual(100);
		});

		it('should calculate requests per second', () => {
			// Record 10 requests
			for (let i = 0; i < 10; i++) {
				aggregator.record(createRequest());
			}

			// Use default range (last hour) - just verify it calculates something reasonable
			const metrics = aggregator.getMetrics();

			expect(metrics.totalRequests).toBe(10);
			// With 10 requests in the default 1 hour range, rps should be small but positive
			expect(metrics.requestsPerSecond).toBeGreaterThan(0);
		});

		it('should generate time series data', () => {
			const now = new Date();
			const bucketSize = 60000; // 1 minute

			// Record requests in different buckets
			aggregator.record(
				createRequest({
					timestamp: new Date(now.getTime() - 2 * bucketSize),
				}),
			);
			aggregator.record(
				createRequest({
					timestamp: new Date(now.getTime() - bucketSize),
				}),
			);
			aggregator.record(createRequest({ timestamp: now }));

			const metrics = aggregator.getMetrics({
				range: {
					start: new Date(now.getTime() - 3 * bucketSize),
					end: now,
				},
			});

			expect(metrics.timeSeries.length).toBeGreaterThan(0);
		});
	});

	describe('getEndpointMetrics', () => {
		it('should track metrics per endpoint', () => {
			aggregator.record(createRequest({ method: 'GET', path: '/users' }));
			aggregator.record(createRequest({ method: 'GET', path: '/users' }));
			aggregator.record(createRequest({ method: 'POST', path: '/users' }));
			aggregator.record(createRequest({ method: 'GET', path: '/posts' }));

			const endpoints = aggregator.getEndpointMetrics();

			expect(endpoints.length).toBe(3);

			const getUsersEndpoint = endpoints.find(
				(e) => e.method === 'GET' && e.path === '/users',
			);
			expect(getUsersEndpoint?.count).toBe(2);

			const postUsersEndpoint = endpoints.find(
				(e) => e.method === 'POST' && e.path === '/users',
			);
			expect(postUsersEndpoint?.count).toBe(1);
		});

		it('should sort by request count descending', () => {
			aggregator.record(createRequest({ path: '/a' }));
			aggregator.record(createRequest({ path: '/b' }));
			aggregator.record(createRequest({ path: '/b' }));
			aggregator.record(createRequest({ path: '/c' }));
			aggregator.record(createRequest({ path: '/c' }));
			aggregator.record(createRequest({ path: '/c' }));

			const endpoints = aggregator.getEndpointMetrics();

			expect(endpoints[0].path).toBe('/c');
			expect(endpoints[0].count).toBe(3);
			expect(endpoints[1].path).toBe('/b');
			expect(endpoints[1].count).toBe(2);
			expect(endpoints[2].path).toBe('/a');
			expect(endpoints[2].count).toBe(1);
		});

		it('should respect limit option', () => {
			for (let i = 0; i < 10; i++) {
				aggregator.record(createRequest({ path: `/path-${i}` }));
			}

			const endpoints = aggregator.getEndpointMetrics({ limit: 5 });
			expect(endpoints.length).toBe(5);
		});

		it('should calculate endpoint error rates', () => {
			aggregator.record(createRequest({ path: '/error', status: 500 }));
			aggregator.record(createRequest({ path: '/error', status: 500 }));
			aggregator.record(createRequest({ path: '/error', status: 200 }));
			aggregator.record(createRequest({ path: '/error', status: 200 }));

			const endpoints = aggregator.getEndpointMetrics();
			const errorEndpoint = endpoints.find((e) => e.path === '/error');

			expect(errorEndpoint?.errorRate).toBe(50);
		});
	});

	describe('getStatusDistribution', () => {
		it('should count status codes by category', () => {
			aggregator.record(createRequest({ status: 200 }));
			aggregator.record(createRequest({ status: 201 }));
			aggregator.record(createRequest({ status: 301 }));
			aggregator.record(createRequest({ status: 400 }));
			aggregator.record(createRequest({ status: 404 }));
			aggregator.record(createRequest({ status: 500 }));

			const dist = aggregator.getStatusDistribution();

			expect(dist['2xx']).toBe(2);
			expect(dist['3xx']).toBe(1);
			expect(dist['4xx']).toBe(2);
			expect(dist['5xx']).toBe(1);
		});

		it('should return zeros when no requests', () => {
			const dist = aggregator.getStatusDistribution();

			expect(dist['2xx']).toBe(0);
			expect(dist['3xx']).toBe(0);
			expect(dist['4xx']).toBe(0);
			expect(dist['5xx']).toBe(0);
		});
	});

	describe('reset', () => {
		it('should clear all metrics', () => {
			aggregator.record(createRequest());
			aggregator.record(createRequest());
			aggregator.record(createRequest());

			expect(aggregator.getMetrics().totalRequests).toBe(3);

			aggregator.reset();

			expect(aggregator.getMetrics().totalRequests).toBe(0);
			expect(aggregator.getEndpointMetrics().length).toBe(0);
		});
	});

	describe('bucket pruning', () => {
		it('should prune old buckets when maxBuckets exceeded', () => {
			const aggregator = new MetricsAggregator({
				bucketSize: 1000, // 1 second buckets
				maxBuckets: 5,
			});

			// Add requests across 10 different seconds
			const baseTime = Date.now();
			for (let i = 0; i < 10; i++) {
				aggregator.record(
					createRequest({
						timestamp: new Date(baseTime + i * 1000),
					}),
				);
			}

			// Query should only return data from the last 5 buckets
			const metrics = aggregator.getMetrics({
				range: {
					start: new Date(baseTime),
					end: new Date(baseTime + 10000),
				},
			});

			// Should have at most 5 buckets worth of data
			expect(metrics.totalRequests).toBeLessThanOrEqual(5);
		});
	});

	describe('custom bucket size', () => {
		it('should use custom bucket size', () => {
			const aggregator = new MetricsAggregator({
				bucketSize: 5000, // 5 second buckets
			});

			// Use a fixed timestamp to ensure all requests fall in the same bucket
			const baseTime = Math.floor(Date.now() / 5000) * 5000; // Align to bucket boundary
			const timestamp = new Date(baseTime);

			// Add 3 requests within the same 5-second bucket
			aggregator.record(createRequest({ timestamp }));
			aggregator.record(createRequest({ timestamp }));
			aggregator.record(createRequest({ timestamp }));

			const metrics = aggregator.getMetrics({
				range: {
					start: new Date(baseTime - 1000),
					end: new Date(baseTime + 6000),
				},
				bucketSize: 5000,
			});

			// Should have at least 1 time series point with 3 requests total
			expect(metrics.totalRequests).toBe(3);
			expect(metrics.timeSeries.length).toBeGreaterThanOrEqual(1);
		});
	});
});
