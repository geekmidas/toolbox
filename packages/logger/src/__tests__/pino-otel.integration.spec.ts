import { Writable } from 'node:stream';
import { context, trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import {
	InMemoryLogRecordExporter,
	LoggerProvider,
	SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OTEL_SCOPE, otelStreamWrite } from '../otel';
import { createLogger } from '../pino';

/** What the logger writes to stdout, parsed. */
function captureStream() {
	const lines: Record<string, unknown>[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			lines.push(JSON.parse(chunk.toString()));
			callback();
		},
	});
	return { stream, lines };
}

describe('pino → OpenTelemetry logs', () => {
	describe('with a LoggerProvider registered', () => {
		const exporter = new InMemoryLogRecordExporter();
		const provider = new LoggerProvider({
			processors: [new SimpleLogRecordProcessor({ exporter })],
		});
		// A real tracer provider, registered with its async-hooks context
		// manager, so `startActiveSpan` makes a span the active one.
		const tracerProvider = new NodeTracerProvider();

		beforeAll(() => {
			tracerProvider.register();
			logs.setGlobalLoggerProvider(provider);
		});

		afterEach(() => exporter.reset());

		afterAll(async () => {
			logs.disable();
			trace.disable();
			context.disable();
			await provider.shutdown();
			await tracerProvider.shutdown();
		});

		it('exports a record inside a span with its severity, body, attributes and trace ids', () => {
			const { stream, lines } = captureStream();
			const logger = createLogger({ destination: stream });

			const tracer = trace.getTracer('test');
			const ids = tracer.startActiveSpan('request', (span) => {
				logger.warn({ orderId: 'ord_1', nested: { n: 2 } }, 'Order slow');
				span.end();
				return span.spanContext();
			});

			const [record] = exporter.getFinishedLogRecords();
			expect(exporter.getFinishedLogRecords()).toHaveLength(1);
			expect(record?.instrumentationScope.name).toBe(OTEL_SCOPE);
			expect(record?.severityNumber).toBe(SeverityNumber.WARN);
			expect(record?.severityText).toBe('WARN');
			expect(record?.body).toBe('Order slow');
			expect(record?.attributes).toMatchObject({
				orderId: 'ord_1',
				nested: { n: 2 },
			});
			expect(record?.attributes).not.toHaveProperty('msg');
			expect(record?.attributes).not.toHaveProperty('level');
			expect(record?.spanContext?.traceId).toBe(ids.traceId);
			expect(record?.spanContext?.spanId).toBe(ids.spanId);
			expect(record?.hrTime[0]).toBe(Math.floor(Number(lines[0]?.time) / 1000));

			// stdout is unchanged by the bridge.
			expect(lines).toHaveLength(1);
			expect(lines[0]).toMatchObject({
				level: 'WARN',
				msg: 'Order slow',
				orderId: 'ord_1',
			});
		});

		it('maps every pino level to its severity', () => {
			const { stream } = captureStream();
			const logger = createLogger({ destination: stream, level: 'trace' });

			logger.trace('t');
			logger.debug('d');
			logger.info('i');
			logger.warn('w');
			logger.error('e');
			logger.fatal('f');

			expect(
				exporter
					.getFinishedLogRecords()
					.map((r) => [r.severityNumber, r.severityText]),
			).toEqual([
				[SeverityNumber.TRACE, 'TRACE'],
				[SeverityNumber.DEBUG, 'DEBUG'],
				[SeverityNumber.INFO, 'INFO'],
				[SeverityNumber.WARN, 'WARN'],
				[SeverityNumber.ERROR, 'ERROR'],
				[SeverityNumber.FATAL, 'FATAL'],
			]);
		});

		it('exports a copy exactly as redacted as stdout', () => {
			const { stream, lines } = captureStream();
			const logger = createLogger({ destination: stream });

			logger.info(
				{
					password: 'hunter2',
					bucket: 's3://k:s@b',
					user: 'ada',
				},
				'Reading s3://k:s@b',
			);

			const [record] = exporter.getFinishedLogRecords();
			const exported = JSON.stringify(record?.attributes) + record?.body;
			expect(exported).not.toContain('hunter2');
			expect(exported).not.toContain('k:s@');
			expect(record?.attributes?.password).toBe('[Redacted]');
			expect(record?.attributes?.bucket).toBe(lines[0]?.bucket);
			expect(record?.body).toBe(lines[0]?.msg);
			expect(record?.attributes?.user).toBe('ada');
		});

		it('bridges a logger made with pino() directly, through otelStreamWrite', () => {
			const { stream } = captureStream();
			const logger = pino({ hooks: { streamWrite: otelStreamWrite } }, stream);

			logger.error({ code: 'E1' }, 'Raw pino');

			const [record] = exporter.getFinishedLogRecords();
			expect(record?.severityNumber).toBe(SeverityNumber.ERROR);
			expect(record?.body).toBe('Raw pino');
			expect(record?.attributes?.code).toBe('E1');
		});

		it('exports nothing below the logger level', () => {
			const { stream } = captureStream();
			const logger = createLogger({ destination: stream, level: 'warn' });

			logger.info('quiet');

			expect(exporter.getFinishedLogRecords()).toHaveLength(0);
		});
	});

	describe('with no LoggerProvider registered', () => {
		it('emits nothing and logs to stdout as before', () => {
			const exporter = new InMemoryLogRecordExporter();
			// A provider that exists but was never registered globally.
			new LoggerProvider({
				processors: [new SimpleLogRecordProcessor({ exporter })],
			});
			const { stream, lines } = captureStream();
			const logger = createLogger({ destination: stream });

			expect(() => logger.info({ a: 1 }, 'hello')).not.toThrow();

			expect(exporter.getFinishedLogRecords()).toHaveLength(0);
			expect(lines).toEqual([
				expect.objectContaining({ level: 'INFO', msg: 'hello', a: 1 }),
			]);
		});
	});
});
