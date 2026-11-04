import {
	type Attributes,
	type Histogram,
	type MeterProvider,
	metrics,
} from '@opentelemetry/api';

/**
 * The HTTP server's request metrics, as the OpenTelemetry semantic conventions
 * name them — so a backend's stock HTTP dashboards (OpenObserve's among them)
 * read them with no mapping.
 *
 * Recorded by the request middleware itself (`honoTelemetryMiddleware`, the
 * Lambda `telemetryMiddleware`, `OTelTelemetry`), not by hooking `node:http`:
 * a bundled server has nothing to hook, and the http instrumentation's own
 * incoming metrics are off wherever its incoming spans are.
 */

const METER_NAME = '@geekmidas/constructs';

/** `http.server.request.duration` — seconds, the spec's bucket boundaries. */
export const HTTP_SERVER_REQUEST_DURATION = 'http.server.request.duration';

const DURATION_BUCKETS = [
	0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

/** What one finished request is recorded with. */
export interface HttpServerRequestMetric {
	method: string;
	/**
	 * The matched route — `/users/:id`, never `/users/42`. Left out when no
	 * route matched (a 404), so a scanner cannot mint a series per path.
	 */
	route?: string;
	scheme?: 'http' | 'https';
	statusCode: number;
	/** How long the request took, in milliseconds. */
	durationMs: number;
	/** What the request failed with, if it threw. */
	error?: Error;
}

/**
 * The histogram, from whichever meter provider is registered now.
 *
 * Kept per provider rather than once: before `setupTelemetry` registers one,
 * the API hands out a no-op meter for good — there is no proxy, as there is
 * for tracers — and a test may register a provider of its own.
 */
let cached: { provider: MeterProvider; histogram: Histogram } | undefined;

function durationHistogram(): Histogram {
	const provider = metrics.getMeterProvider();
	if (cached?.provider !== provider) {
		const histogram = provider
			.getMeter(METER_NAME)
			.createHistogram(HTTP_SERVER_REQUEST_DURATION, {
				description: 'Duration of HTTP server requests.',
				unit: 's',
				advice: { explicitBucketBoundaries: DURATION_BUCKETS },
			});
		cached = { provider, histogram };
	}
	return cached.histogram;
}

/** A known method as itself; anything else as `_OTHER`, as the spec says. */
const KNOWN_METHODS = new Set([
	'CONNECT',
	'DELETE',
	'GET',
	'HEAD',
	'OPTIONS',
	'PATCH',
	'POST',
	'PUT',
	'TRACE',
]);

/**
 * Records one finished request on `http.server.request.duration`. A no-op
 * until a meter provider is registered.
 *
 * `error.type` is set on a server failure only — the thrown error's name, or
 * the status code — since a 4xx is the client's, not the server's.
 */
export function recordHttpServerRequest(
	request: HttpServerRequestMetric,
): void {
	const method = request.method.toUpperCase();
	const attributes: Attributes = {
		'http.request.method': KNOWN_METHODS.has(method) ? method : '_OTHER',
		'http.response.status_code': request.statusCode,
	};
	if (request.route) attributes['http.route'] = request.route;
	if (request.scheme) attributes['url.scheme'] = request.scheme;
	if (request.statusCode >= 500) {
		attributes['error.type'] =
			request.error?.name ?? String(request.statusCode);
	}

	durationHistogram().record(
		Math.max(0, request.durationMs) / 1000,
		attributes,
	);
}
