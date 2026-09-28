import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../storage/memory';
import { Telescope } from '../../Telescope';
import type { LogEntry, RequestEntry } from '../../types';
import { createOTLPRoutes } from '../hono';
import { SeverityNumber, SpanKind } from '../types';

/** A storage that refuses every write, so the receiver reports partial success. */
class RefusingStorage extends InMemoryStorage {
	override async saveRequest(_entry: RequestEntry): Promise<void> {
		throw new Error('disk full');
	}
	override async saveLogs(_entries: LogEntry[]): Promise<void> {
		throw new Error('disk full');
	}
}

const traces = {
	resourceSpans: [
		{
			scopeSpans: [
				{
					spans: [
						{
							traceId: 't',
							spanId: 's',
							name: 'GET /users',
							kind: SpanKind.SPAN_KIND_SERVER,
							startTimeUnixNano: '1000000000',
							endTimeUnixNano: '2000000000',
							attributes: [
								{ key: 'http.method', value: { stringValue: 'GET' } },
							],
						},
					],
				},
			],
		},
	],
};

const logs = {
	resourceLogs: [
		{
			scopeLogs: [
				{
					logRecords: [
						{
							severityNumber: SeverityNumber.SEVERITY_NUMBER_INFO,
							body: { stringValue: 'hello' },
						},
					],
				},
			],
		},
	],
};

const metrics = {
	resourceMetrics: [
		{
			scopeMetrics: [
				{
					metrics: [
						{
							name: 'orders',
							sum: {
								dataPoints: [{ timeUnixNano: '1000000000', asInt: '2' }],
							},
						},
					],
				},
			],
		},
	],
};

const post = (
	app: ReturnType<typeof createOTLPRoutes>,
	path: string,
	body: unknown,
	type = 'application/json',
) =>
	app.request(path, {
		method: 'POST',
		headers: { 'content-type': type },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});

describe('createOTLPRoutes', () => {
	const telescopes: Telescope[] = [];
	const make = (storage = new InMemoryStorage(), extra = {}) => {
		const telescope = new Telescope({ storage });
		telescopes.push(telescope);
		return {
			telescope,
			app: createOTLPRoutes({ telescope, ...extra }),
		};
	};

	afterEach(() => {
		for (const t of telescopes.splice(0)) t.destroy();
	});

	it('records traces and logs it receives as JSON', async () => {
		const { app, telescope } = make();

		expect((await post(app, '/traces', traces)).status).toBe(200);
		expect((await post(app, '/logs', logs)).status).toBe(200);

		expect(await telescope.getRequests()).toHaveLength(1);
		expect((await telescope.getLogs()).map((l) => l.message)).toContain(
			'hello',
		);
	});

	it('hands metrics to the handler', async () => {
		const seen: unknown[] = [];
		const { app } = make(new InMemoryStorage(), {
			onMetrics: (points: unknown[]) => {
				seen.push(...points);
			},
		});

		const res = await post(app, '/metrics', metrics);

		expect(res.status).toBe(200);
		expect(seen).toHaveLength(1);
	});

	it.each([
		'/traces',
		'/logs',
		'/metrics',
	])('refuses anything but JSON on %s', async (path) => {
		const { app } = make();

		const res = await post(app, path, 'x', 'application/x-protobuf');

		expect(res.status).toBe(415);
		expect(await res.json()).toEqual({
			error: 'Only application/json is supported',
		});
	});

	it.each([
		'/traces',
		'/logs',
		'/metrics',
	])('answers 400 to a body that is not JSON on %s', async (path) => {
		const { app } = make();

		const res = await post(app, path, '{not json');

		expect(res.status).toBe(400);
		expect((await res.json()).error).toBeTruthy();
	});

	it('answers 206 with what it could not store', async () => {
		const { app } = make(new RefusingStorage(), {
			onMetrics: () => {
				throw new Error('handler down');
			},
		});

		const t = await post(app, '/traces', traces);
		const l = await post(app, '/logs', logs);
		const m = await post(app, '/metrics', metrics);

		expect([t.status, l.status, m.status]).toEqual([206, 206, 206]);
		expect(await t.json()).toEqual({
			partialSuccess: { rejectedSpans: '1' },
		});
		expect(await l.json()).toEqual({
			partialSuccess: { rejectedLogRecords: '1' },
		});
		expect(await m.json()).toEqual({
			partialSuccess: { rejectedDataPoints: '1' },
		});
	});
});
