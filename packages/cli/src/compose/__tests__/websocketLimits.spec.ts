import { edgeCaddyfile } from '@geekmidas/edge/proxy/caddy';
import { traefikDynamic } from '@geekmidas/edge/proxy/traefik';
import type { EdgeRoute } from '@geekmidas/edge/routes';
import { describe, expect, it } from 'vitest';

const realtime: EdgeRoute = {
	name: 'realtime',
	host: 'realtime.example.com',
	upstreams: [
		{ service: 'realtime', port: 3001 },
		{ service: 'realtime-2', port: 3001 },
	],
	streaming: true,
	health: '/health',
	limits: { handshakesPerMinute: 120, connectionsPerIp: 256 },
};

type Dynamic = {
	http: {
		routers: Record<string, { middlewares?: string[] }>;
		middlewares: Record<string, unknown>;
	};
};

describe("a WebSocket surface's limits at the edge", () => {
	const { http } = traefikDynamic([realtime], {
		project: 'shop-production',
		tls: { kind: 'acme' },
		edgeToken: 'the-token',
	}) as Dynamic;

	it('are a rateLimit and an inFlightReq on its Traefik router, per client address', () => {
		expect(http.routers['shop-production-realtime']?.middlewares).toEqual([
			'shop-production-strip-gkm-headers',
			'shop-production-realtime-rate',
			'shop-production-realtime-in-flight',
		]);
		expect(http.middlewares['shop-production-realtime-rate']).toEqual({
			rateLimit: { average: 120, period: '1m', burst: 120 },
		});
		expect(http.middlewares['shop-production-realtime-in-flight']).toEqual({
			inFlightReq: { amount: 256 },
		});
	});

	it("are not applied to the stack's own services, which share one address", () => {
		expect(
			http.routers['shop-production-realtime-stack']?.middlewares,
		).toBeUndefined();
	});

	it('render only what is declared', () => {
		const { http: one } = traefikDynamic(
			[{ ...realtime, limits: { connectionsPerIp: 10 } }],
			{ project: 'p', tls: { kind: 'acme' } },
		) as Dynamic;
		expect(one.routers['p-realtime']?.middlewares).toEqual([
			'p-strip-gkm-headers',
			'p-realtime-in-flight',
		]);

		const { http: none } = traefikDynamic(
			[{ ...realtime, limits: undefined }],
			{ project: 'p', tls: { kind: 'acme' } },
		) as Dynamic;
		expect(none.routers['p-realtime']?.middlewares).toEqual([
			'p-strip-gkm-headers',
		]);
	});

	it('leave Caddy, which has no rate limiter, to the surface', () => {
		const caddyfile = edgeCaddyfile([realtime], { tls: { kind: 'acme' } });
		expect(caddyfile).toContain('reverse_proxy realtime:3001 realtime-2:3001');
		expect(caddyfile).not.toMatch(/rate_limit|inflight/i);
	});
});
