import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POSTGRES_PORT, REDIS_PORT } from '../../../testkit/test/ports';
import type { Cache } from '../index';
import { cacheTableStatements, PostgresCache } from '../postgres';
import { redisCacheDriver } from '../redis';

/**
 * `cache.get`/`set`/`delete` spans, with hit or miss, against the real Redis
 * and the real Postgres — and none without a provider.
 */

const schema = `cache_trace_${Math.random().toString(36).slice(2, 8)}`;
const pool = new pg.Pool({
	connectionString: `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/postgres`,
});
const caches: [string, Cache][] = [
	['redis', redisCacheDriver.create(`redis://localhost:${REDIS_PORT}`)],
	['postgresql', new PostgresCache(pool, { table: `${schema}.entries` })],
];

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const KEY = `user:${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
	await pool.query(`CREATE SCHEMA "${schema}"`);
	for (const statement of cacheTableStatements({
		table: `${schema}.entries`,
	})) {
		await pool.query(statement.sql);
	}
});

afterAll(async () => {
	await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	await pool.end();
	await provider.shutdown();
	trace.disable();
	context.disable();
	propagation.disable();
});

describe('without a provider', () => {
	it.each(caches)('%s records nothing', async (_system, cache) => {
		await cache.set(KEY, { id: 1 });
		expect(await cache.get(KEY)).toEqual({ id: 1 });
		await cache.delete(KEY);
		expect(exporter.getFinishedSpans()).toEqual([]);
	});
});

describe('with a provider', () => {
	beforeAll(() => provider.register());
	beforeEach(() => exporter.reset());

	it.each(
		caches,
	)('%s: a span per call, with hit and miss, never the key', async (system, cache) => {
		await cache.set(KEY, { id: 1 });
		await cache.get(KEY);
		await cache.delete(KEY);
		await cache.get(KEY);

		const spans = exporter.getFinishedSpans();
		expect(spans.map((s) => s.name)).toEqual([
			'cache.set',
			'cache.get',
			'cache.delete',
			'cache.get',
		]);
		for (const span of spans) {
			expect(span.kind).toBe(SpanKind.CLIENT);
			expect(span.attributes['db.system']).toBe(system);
			expect(JSON.stringify(span.attributes)).not.toContain(KEY);
		}
		expect(spans[1]!.attributes['cache.hit']).toBe(true);
		expect(spans[3]!.attributes['cache.hit']).toBe(false);
	});
});
