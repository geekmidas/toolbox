import { describe, expect, it } from 'vitest';
import {
	transformLogs,
	transformMetrics,
	transformTraces,
} from '../transformer';
import {
	type KeyValue,
	SeverityNumber,
	type Span,
	SpanKind,
	SpanStatusCode,
} from '../types';

const str = (key: string, value: string): KeyValue => ({
	key,
	value: { stringValue: value },
});

function serverSpan(overrides: Partial<Span> = {}): Span {
	return {
		traceId: 't1',
		spanId: 's1',
		name: 'GET /',
		kind: SpanKind.SPAN_KIND_SERVER,
		startTimeUnixNano: '1000000000',
		endTimeUnixNano: '1250000000',
		attributes: [str('http.method', 'get')],
		...overrides,
	} as Span;
}

function traces(spans: Span[], resource?: KeyValue[]) {
	return transformTraces({
		resourceSpans: [
			{
				...(resource ? { resource: { attributes: resource } } : {}),
				scopeSpans: [{ spans }],
			},
		],
	} as never);
}

describe('transformTraces', () => {
	it('reads the newer semantic-convention attribute names', () => {
		const [entry] = traces([
			serverSpan({
				attributes: [
					str('http.request.method', 'post'),
					str('url.path', '/orders'),
					str('url.full', 'https://shop.test/orders'),
					str('user_agent.original', 'curl/8'),
					str('http.request.header.content_type', 'application/json'),
					str('client.address', '10.0.0.1'),
					{ key: 'http.response.status_code', value: { intValue: '201' } },
				],
			}),
		]);

		expect(entry).toMatchObject({
			method: 'POST',
			path: '/orders',
			url: 'https://shop.test/orders',
			headers: { 'user-agent': 'curl/8', 'content-type': 'application/json' },
			ip: '10.0.0.1',
			status: 201,
			duration: 250,
		});
	});

	it('falls back to the route and a localhost URL', () => {
		const [entry] = traces([
			serverSpan({
				attributes: [
					str('http.method', 'delete'),
					str('http.route', '/users/:id'),
					str('http.client_ip', '::1'),
				],
			}),
		]);

		expect(entry).toMatchObject({
			method: 'DELETE',
			path: '/users/:id',
			url: 'http://localhost/users/:id',
			ip: '::1',
		});
	});

	it('assumes GET when a server span names no method', () => {
		const [entry] = traces([
			serverSpan({ attributes: [str('http.target', '/health')] }),
		]);

		expect(entry).toMatchObject({ method: 'GET', path: '/health' });
	});

	it('does not treat a route alone as an HTTP request', () => {
		expect(
			traces([serverSpan({ attributes: [str('http.route', '/users')] })]),
		).toEqual([]);
	});

	it('defaults the path to / when a span names only its URL', () => {
		const [entry] = traces([
			serverSpan({ attributes: [str('http.url', 'https://shop.test/')] }),
		]);

		expect(entry?.path).toBe('/');
		expect(entry?.ip).toBeUndefined();
	});

	it.each([
		['a numeric string', [str('http.status_code', '404')], undefined, 404],
		[
			'an unparseable string',
			[str('http.status_code', 'nope')],
			undefined,
			200,
		],
		[
			'the older attribute name',
			[{ key: 'http.response_status_code', value: { intValue: '302' } }],
			undefined,
			302,
		],
		['an error status', [], SpanStatusCode.STATUS_CODE_ERROR, 500],
		['an ok status', [], SpanStatusCode.STATUS_CODE_OK, 200],
		['nothing at all', [], undefined, 200],
	])('takes the status from %s', (_label, extra, code, status) => {
		const [entry] = traces([
			serverSpan({
				attributes: [str('http.target', '/'), ...extra],
				...(code === undefined ? {} : { status: { code } }),
			} as Partial<Span>),
		]);

		expect(entry?.status).toBe(status);
	});

	it('tags the service when the resource names one', () => {
		const [entry] = traces([serverSpan()], [str('service.name', 'api')]);

		expect(entry?.tags).toEqual(['trace:t1', 'span:s1', 'service:api']);
	});

	it('skips spans that are not HTTP server spans', () => {
		expect(
			traces([
				serverSpan({ kind: SpanKind.SPAN_KIND_CLIENT }),
				serverSpan({ attributes: [str('db.system', 'postgresql')] }),
			]),
		).toEqual([]);
	});

	it('accepts a request with missing levels', () => {
		expect(transformTraces({} as never)).toEqual([]);
		expect(
			transformTraces({ resourceSpans: [{}, { scopeSpans: [{}] }] } as never),
		).toEqual([]);
	});
});

describe('transformLogs', () => {
	const log = (record: Record<string, unknown>, scope?: string) =>
		transformLogs({
			resourceLogs: [
				{
					scopeLogs: [
						{
							...(scope ? { scope: { name: scope } } : {}),
							logRecords: [record],
						},
					],
				},
			],
		} as never)[0];

	it.each([
		[undefined, 'info'],
		[SeverityNumber.SEVERITY_NUMBER_DEBUG, 'debug'],
		[SeverityNumber.SEVERITY_NUMBER_INFO, 'info'],
		[SeverityNumber.SEVERITY_NUMBER_WARN, 'warn'],
		[SeverityNumber.SEVERITY_NUMBER_ERROR, 'error'],
		[SeverityNumber.SEVERITY_NUMBER_FATAL, 'error'],
	])('maps severity %s to %s', (severityNumber, level) => {
		expect(log({ severityNumber }).level).toBe(level);
	});

	it('serialises a structured body and decodes every value type', () => {
		const entry = log({
			body: {
				kvlistValue: {
					values: [
						{ key: 'ok', value: { boolValue: true } },
						{ key: 'n', value: { intValue: '7' } },
						{ key: 'ratio', value: { doubleValue: 0.5 } },
						{ key: 'raw', value: { bytesValue: 'YQ==' } },
						{
							key: 'list',
							value: { arrayValue: { values: [{ stringValue: 'a' }, {}] } },
						},
						{ key: 'none' },
					],
				},
			},
		});

		expect(JSON.parse(entry.message)).toEqual({
			ok: true,
			n: 7,
			ratio: 0.5,
			raw: 'YQ==',
			list: ['a', null],
		});
	});

	it('carries the scope, severity text and span into the context', () => {
		const entry = log(
			{
				body: { stringValue: 'hello' },
				severityText: 'NOTICE',
				spanId: 'abc',
				attributes: [str('user', 'u1')],
			},
			'my-lib',
		);

		expect(entry).toMatchObject({
			message: 'hello',
			requestId: 'span:abc',
			context: {
				user: 'u1',
				'instrumentation.scope': 'my-lib',
				'severity.text': 'NOTICE',
			},
		});
	});

	it('leaves the context out when there is nothing to say', () => {
		const entry = log({});

		expect(entry.message).toBe('');
		expect(entry.context).toBeUndefined();
		expect(entry.requestId).toBeUndefined();
	});

	it('accepts a request with missing levels', () => {
		expect(transformLogs({} as never)).toEqual([]);
		expect(
			transformLogs({ resourceLogs: [{}, { scopeLogs: [{}] }] } as never),
		).toEqual([]);
	});
});

describe('transformMetrics', () => {
	const metrics = (metric: Record<string, unknown>) =>
		transformMetrics({
			resourceMetrics: [
				{
					resource: { attributes: [str('service.name', 'api')] },
					scopeMetrics: [{ metrics: [{ name: 'm', unit: 'ms', ...metric }] }],
				},
			],
		} as never);

	const at = '1700000000000000000';

	it('reads gauges and sums as doubles, ints, or zero', () => {
		const points = [
			...metrics({
				gauge: {
					dataPoints: [
						{ timeUnixNano: at, asDouble: 1.5 },
						{ timeUnixNano: at, asInt: '3' },
					],
				},
			}),
			...metrics({ sum: { dataPoints: [{ timeUnixNano: at }] } }),
		];

		expect(points.map((p) => [p.type, p.value])).toEqual([
			['gauge', 1.5],
			['gauge', 3],
			['sum', 0],
		]);
		expect(points[0]).toMatchObject({
			unit: 'ms',
			resourceAttributes: { 'service.name': 'api' },
			timestamp: new Date(1_700_000_000_000),
		});
	});

	it('takes a histogram or summary sum as the value, with the rest as attributes', () => {
		const [histogram, empty] = metrics({
			histogram: {
				dataPoints: [
					{ timeUnixNano: at, sum: 42, count: '3', min: 1, max: 30 },
					{ timeUnixNano: at, count: '0' },
				],
			},
		});
		const [summary] = metrics({
			summary: {
				dataPoints: [
					{
						timeUnixNano: at,
						count: '2',
						quantileValues: [{ quantile: 0.5, value: 9 }],
					},
				],
			},
		});

		expect(histogram).toMatchObject({
			type: 'histogram',
			value: 42,
			attributes: { count: 3, min: 1, max: 30 },
		});
		expect(empty?.value).toBe(0);
		expect(summary).toMatchObject({
			type: 'summary',
			value: 0,
			attributes: { count: 2, quantiles: [{ quantile: 0.5, value: 9 }] },
		});
	});

	it('accepts a request with missing levels', () => {
		expect(transformMetrics({} as never)).toEqual([]);
		expect(
			transformMetrics({
				resourceMetrics: [{}, { scopeMetrics: [{}] }],
			} as never),
		).toEqual([]);
	});
});
