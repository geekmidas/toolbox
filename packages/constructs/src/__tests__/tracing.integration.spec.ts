import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery, serviceContext } from '@geekmidas/services';
import {
	context,
	propagation,
	SpanKind,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import type { Context, SQSRecord } from 'aws-lambda';
import { type Kysely, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { POSTGRES_PORT } from '../../../testkit/test/ports';
import { BetterAuth } from '../auth';
import { CronBuilder } from '../crons/CronBuilder';
import { runCron } from '../crons/runCron';
import { KyselyDatabase } from '../database/kysely';
import { closeDatabasePools, MAX_STATEMENT_LENGTH } from '../database/pool';
import { AWSLambdaQueue } from '../queue/AWSLambdaQueueAdaptor';
import { QueueBuilder } from '../queue/QueueBuilder';
import { traceClient } from '../tracing';

/**
 * The spans the constructs record themselves, against the test Postgres, with
 * a real tracer provider — and nothing at all without one.
 */

const URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const SECRET = 'do-not-record-this-value';

const connect = (): Promise<Kysely<any>> =>
	Promise.resolve(
		new KyselyDatabase<Record<string, never>, 'Traced'>(
			'Traced',
		).service.register({
			envParser: new EnvironmentParser({ TRACED_URL: URL }),
			context: serviceContext,
		}),
	);

/** A client with a private field, as an SDK's often has. */
class PaymentsClient {
	#token = 'secret';
	async charge(amount: number) {
		await new Promise((resolve) => setTimeout(resolve, 1));
		return { amount, token: this.#token.length };
	}
	version() {
		return 'v1';
	}
	async fail() {
		throw new PaymentDeclined();
	}
}

class PaymentDeclined extends Error {
	constructor() {
		super('declined');
		this.name = 'PaymentDeclined';
	}
}

const lambdaContext = {
	functionName: 'orders-worker',
	awsRequestId: 'req-1',
} as Context;

function queueLambda(seen: string[]) {
	const queue = new QueueBuilder()
		.queue('orders')
		.message(z.object({ orderId: z.string() }))
		.handle(async () => {
			seen.push(trace.getActiveSpan()?.spanContext().spanId ?? 'none');
		});
	return new AWSLambdaQueue(new EnvironmentParser({}), queue);
}

const sqsRecord = (messageId: string, traceparent?: string): SQSRecord =>
	({
		messageId,
		body: JSON.stringify({ type: 'orders', payload: { orderId: messageId } }),
		messageAttributes: traceparent
			? { traceparent: { stringValue: traceparent, dataType: 'String' } }
			: {},
	}) as unknown as SQSRecord;

/** The trace each cron run saw itself in. */
const cronTraces: (string | undefined)[] = [];
const cron = () =>
	new CronBuilder().schedule('rate(1 hour)').handle(async () => {
		cronTraces.push(trace.getActiveSpan()?.spanContext().traceId);
	});

let db: Kysely<any>;
beforeAll(async () => {
	db = await connect();
});
afterAll(async () => {
	await closeDatabasePools();
});

describe('without a provider', () => {
	it('records nothing and changes nothing', async () => {
		const { rows } = await sql<{
			n: number;
		}>`select ${1}::int as n`.execute(db);
		expect(rows).toEqual([{ n: 1 }]);
		// No span, so no `traceparent` in the query's tag — no tag at all.
		const { rows: text } = await sql<{
			q: string;
		}>`select current_query() as q`.execute(db);
		expect(text[0]!.q).toBe('select current_query() as q');

		const client = traceClient('Payments', new PaymentsClient());
		await expect(client.charge(5)).resolves.toEqual({ amount: 5, token: 6 });

		ServiceDiscovery.reset();
		const discovery = ServiceDiscovery.getInstance(new EnvironmentParser({}));
		expect(await runCron(cron(), discovery, 'hourly')).toBeUndefined();

		const seen: string[] = [];
		await queueLambda(seen).handler(
			{
				Records: [sqsRecord('m1', `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`)],
			},
			lambdaContext,
			() => {},
		);
		expect(seen).toEqual(['none']);
	});
});

describe('with a provider', () => {
	const exporter = new InMemorySpanExporter();
	const provider = new NodeTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	const spans = () => exporter.getFinishedSpans();

	beforeAll(() => {
		provider.register();
	});
	afterAll(async () => {
		await provider.shutdown();
		trace.disable();
		context.disable();
		propagation.disable();
	});
	beforeEach(() => exporter.reset());

	describe('database queries', () => {
		it('a span per query, named for its operation and table, without values', async () => {
			await db
				.selectFrom('pg_class')
				.select('relname')
				.where('relname', '=', SECRET)
				.execute();

			const span = spans().find((s) => s.name === 'select pg_class');
			expect(span).toBeDefined();
			expect(span!.kind).toBe(SpanKind.CLIENT);
			expect(span!.attributes).toMatchObject({
				'db.system': 'postgresql',
				'db.name': 'geekmidas',
				'db.operation': 'select',
				'db.sql.table': 'pg_class',
				'server.address': 'localhost',
				'server.port': POSTGRES_PORT,
			});
			expect(span!.attributes['db.statement']).toContain('$1');
			expect(JSON.stringify(span!.attributes)).not.toContain(SECRET);
			expect(span!.events).toEqual([]);
		});

		it('is the child of the span active when it ran', async () => {
			const parent = await trace
				.getTracer('test')
				.startActiveSpan('POST /orders', async (span) => {
					await sql`select 1`.execute(db);
					span.end();
					return span.spanContext();
				});

			const query = spans().find(
				(s) =>
					s.spanContext().traceId === parent.traceId &&
					s.name !== 'POST /orders',
			);
			expect(query?.parentSpanContext?.spanId).toBe(parent.spanId);
			// No table to name it by.
			expect(query?.name).toBe('db.query');
		});

		it('truncates a long statement', async () => {
			const columns = Array.from({ length: 400 }, (_, i) => `${i} as c${i}`);
			await sql`select ${sql.raw(columns.join(', '))}`.execute(db);

			const span = spans().find((s) => s.name === 'db.query');
			expect(
				String(span?.attributes['db.statement']).length,
			).toBeLessThanOrEqual(MAX_STATEMENT_LENGTH);
		});

		it('records a failed query as an error', async () => {
			await expect(
				sql`select * from no_such_table_here`.execute(db),
			).rejects.toThrow();

			const span = spans().find((s) => s.name === 'select no_such_table_here');
			expect(span?.status.code).toBe(SpanStatusCode.ERROR);
		});
	});

	describe('query tags', () => {
		/** `traceparent` for a recorded span. */
		const traceparentOf = (span: {
			spanContext(): { traceId: string; spanId: string };
		}) => `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`;

		it("carry the query span's traceparent, in sqlcommenter form", async () => {
			const q = await trace
				.getTracer('test')
				.startActiveSpan('GET /orders', async (span) => {
					const { rows } = await sql<{
						q: string;
					}>`select current_query() as q`.execute(db);
					span.end();
					return rows[0]!.q;
				});

			const query = spans().find((s) =>
				String(s.attributes['db.statement']).includes('current_query'),
			);
			expect(query).toBeDefined();
			expect(q).toBe(
				`select current_query() as q /*traceparent='${traceparentOf(query!)}'*/`,
			);
		});

		it('show in pg_stat_activity, seen from another connection', async () => {
			const observer = new pg.Client({ connectionString: URL });
			await observer.connect();
			try {
				const seen = await db.connection().execute(async (conn) => {
					const { rows } = await sql<{
						pid: number;
					}>`select pg_backend_pid() as pid`.execute(conn);
					const pid = rows[0]!.pid;

					return trace
						.getTracer('test')
						.startActiveSpan('POST /reports', async (span) => {
							const running = sql`select pg_sleep(0.5)`.execute(conn);
							let query = '';
							for (let i = 0; i < 20 && !query.includes('pg_sleep'); i++) {
								await new Promise((r) => setTimeout(r, 25));
								const activity = await observer.query<{ query: string }>(
									'select query from pg_stat_activity where pid = $1',
									[pid],
								);
								query = activity.rows[0]?.query ?? '';
							}
							await running;
							span.end();
							return query;
						});
				});

				const sleep = spans().find((s) =>
					String(s.attributes['db.statement']).includes('pg_sleep'),
				);
				expect(sleep).toBeDefined();
				expect(seen).toBe(
					`select pg_sleep(0.5) /*traceparent='${traceparentOf(sleep!)}'*/`,
				);
			} finally {
				await observer.end();
			}
		});
	});

	describe('session checks', () => {
		/** An auth server that records the `traceparent` each request carried. */
		async function authServer() {
			const received: (string | undefined)[] = [];
			const server = createServer((req, res) => {
				received.push(req.headers.traceparent);
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end('null');
			});
			await new Promise<void>((resolve) => server.listen(0, resolve));
			const { port } = server.address() as AddressInfo;
			const client = new BetterAuth('Auth', {
				database: new KyselyDatabase('AuthDb'),
				path: 'apps/auth',
			}).client(
				new EnvironmentParser({ AUTH_URL: `http://127.0.0.1:${port}` }),
			);
			return {
				received,
				client,
				close: () => new Promise((resolve) => server.close(resolve)),
			};
		}

		it('carry the active trace context to the auth server', async () => {
			const auth = await authServer();
			try {
				const parent = await trace
					.getTracer('test')
					.startActiveSpan('GET /me', async (span) => {
						await auth.client.api.getSession({ headers: {} });
						span.end();
						return span.spanContext();
					});

				expect(auth.received).toEqual([
					`00-${parent.traceId}-${parent.spanId}-01`,
				]);
			} finally {
				await auth.close();
			}
		});

		it('leave it to a fetch instrumentation that writes its own', async () => {
			// What OpenTelemetry's undici instrumentation does: append the
			// request's own CLIENT span as `traceparent`. A second one written
			// here would arrive joined to it, and be read as neither.
			const own = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;
			const instrument = (message: unknown) => {
				(
					message as { request: { addHeader(k: string, v: string): void } }
				).request.addHeader('traceparent', own);
			};
			subscribe('undici:request:create', instrument);
			const auth = await authServer();
			try {
				await trace
					.getTracer('test')
					.startActiveSpan('GET /me', async (span) => {
						await auth.client.api.getSession({ headers: {} });
						span.end();
					});

				expect(auth.received).toEqual([own]);
			} finally {
				unsubscribe('undici:request:create', instrument);
				await auth.close();
			}
		});
	});

	describe('ExternalApi clients', () => {
		it('a span per call, carrying the API name, parenting what it does', async () => {
			const client = traceClient('Payments', new PaymentsClient(), {
				'server.address': 'payments.example',
			});

			const result = await client.charge(10);
			expect(result).toEqual({ amount: 10, token: 6 });
			expect(client.version()).toBe('v1');
			expect(client).toBeInstanceOf(PaymentsClient);

			const charge = spans().find((s) => s.name === 'Payments.charge');
			expect(charge?.attributes).toMatchObject({
				'gkm.external_api.name': 'Payments',
				'gkm.external_api.method': 'charge',
				'server.address': 'payments.example',
			});

			await expect(client.fail()).rejects.toBeInstanceOf(PaymentDeclined);
			const failed = spans().find((s) => s.name === 'Payments.fail');
			expect(failed?.status.code).toBe(SpanStatusCode.ERROR);
		});
	});

	describe('crons', () => {
		it('each run is a root trace of its own', async () => {
			ServiceDiscovery.reset();
			const discovery = ServiceDiscovery.getInstance(new EnvironmentParser({}));

			const outer = await trace
				.getTracer('test')
				.startActiveSpan('boot', async (span) => {
					await runCron(cron(), discovery, 'hourly');
					span.end();
					return span.spanContext().traceId;
				});
			const ran = cronTraces.at(-1);

			const run = spans().find((s) => s.name === 'cron hourly');
			expect(run).toBeDefined();
			expect(run!.parentSpanContext).toBeUndefined();
			expect(run!.attributes['gkm.cron.schedule']).toBe('rate(1 hour)');
			expect(ran).toBe(run!.spanContext().traceId);
			expect(ran).not.toBe(outer);
		});
	});

	describe('Lambda queue consumers', () => {
		it('one record: the consumer span continues its producer', async () => {
			const traceId = '3'.repeat(32);
			const seen: string[] = [];
			await queueLambda(seen).handler(
				{ Records: [sqsRecord('m1', `00-${traceId}-${'4'.repeat(16)}-01`)] },
				lambdaContext,
				() => {},
			);

			const consumer = spans().find((s) => s.kind === SpanKind.CONSUMER);
			expect(consumer?.spanContext().traceId).toBe(traceId);
			expect(consumer?.parentSpanContext?.spanId).toBe('4'.repeat(16));
			expect(consumer?.attributes['messaging.destination.name']).toBe('orders');
			expect(seen).toEqual([consumer!.spanContext().spanId]);
		});

		it('a batch: a root that links to each producer', async () => {
			const seen: string[] = [];
			await queueLambda(seen).handler(
				{
					Records: [
						sqsRecord('m1', `00-${'5'.repeat(32)}-${'6'.repeat(16)}-01`),
						sqsRecord('m2', `00-${'7'.repeat(32)}-${'8'.repeat(16)}-01`),
						sqsRecord('m3'),
					],
				},
				lambdaContext,
				() => {},
			);

			const consumer = spans().find((s) => s.kind === SpanKind.CONSUMER);
			expect(consumer?.parentSpanContext).toBeUndefined();
			expect(consumer?.links.map((l) => l.context.spanId)).toEqual([
				'6'.repeat(16),
				'8'.repeat(16),
			]);
		});
	});
});
