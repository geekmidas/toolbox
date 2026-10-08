import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
	ConsoleSpanExporter,
	type Sampler,
	type SpanExporter,
} from '@opentelemetry/sdk-trace-node';
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { SpanProcessorStrategy } from '../adapters/types';
import {
	createSpanProcessor,
	getRecommendedStrategy,
	setGlobalLogProcessor,
	setGlobalSpanProcessor,
} from './core';
import { traceSampler, traceSamplerFromEnv } from './sampler';

/**
 * Options for configuring telemetry
 */
export interface TelemetryOptions {
	/**
	 * Service name for resource identification
	 */
	serviceName: string;

	/**
	 * Service version
	 */
	serviceVersion?: string;

	/**
	 * The `service.namespace` resource attribute — the product an app is part
	 * of, so several services from one workspace group together.
	 */
	serviceNamespace?: string;

	/**
	 * The stage this process runs as (`production`, `staging`, …). Sent as
	 * `deployment.environment.name`, and as the older `deployment.environment`
	 * many backends still filter on.
	 */
	deploymentEnvironment?: string;

	/**
	 * OTLP endpoint URL (e.g., 'http://localhost:3000/__telescope/v1').
	 * Traces go to `<endpoint>/traces` and logs to `<endpoint>/logs`.
	 *
	 * If not provided, the standard `OTEL_EXPORTER_OTLP_ENDPOINT` (and its
	 * per-signal `_TRACES_`/`_LOGS_` variants and `OTEL_EXPORTER_OTLP_HEADERS`)
	 * configure the exporters, with the spec's `/v1/traces` and `/v1/logs`
	 * paths. With neither, traces are written to the console.
	 */
	endpoint?: string;

	/**
	 * The fraction of new traces to sample, from 0 to 1. A span whose parent
	 * in this process was sampled (or not) follows its parent, so a trace is
	 * never cut in half; a caller's sampled flag is capped at this rate, so a
	 * request cannot force a trace the stage would not keep (`traceSampler`).
	 *
	 * When left out, the standard `OTEL_TRACES_SAMPLER` and
	 * `OTEL_TRACES_SAMPLER_ARG` decide — `parentbased_traceidratio` with `0.1`
	 * is the same capped sampler at 0.1; with neither, every trace is sampled.
	 */
	sampleRatio?: number;

	/**
	 * Shut the SDK down and exit on `SIGTERM`.
	 *
	 * Turn it off when the process has its own graceful shutdown — exiting as
	 * soon as telemetry is flushed would cut in-flight requests short.
	 * @default true
	 */
	handleSignals?: boolean;

	/**
	 * Whether to instrument Pino for log correlation.
	 *
	 * It hooks module loading, so it sees nothing inside a bundle. A logger
	 * from `@geekmidas/logger`'s `createLogger` sends its records through the
	 * logs API itself; turn this off for one, or each record is sent twice
	 * where pino can be hooked.
	 * @default true
	 */
	instrumentPino?: boolean;

	/**
	 * Whether the http auto-instrumentation opens a span for each incoming
	 * request.
	 *
	 * Turn it off when the server opens its own — `honoTelemetryMiddleware`,
	 * as a `gkm build` server does — or each request is traced twice where
	 * `node:http` can be hooked, and not at all in a bundle, where it cannot.
	 * Outgoing requests are traced either way.
	 * @default true
	 */
	incomingHttpSpans?: boolean;

	/**
	 * Whether to enable auto-instrumentation for common libraries
	 * (http, fetch, express, etc.)
	 * @default true
	 */
	autoInstrument?: boolean;

	/**
	 * Enable debug logging for OTel SDK
	 * @default false
	 */
	debug?: boolean;

	/**
	 * Additional resource attributes
	 */
	resourceAttributes?: Record<string, string>;

	/**
	 * Headers to send with OTLP requests
	 */
	headers?: Record<string, string>;

	/**
	 * Span processor strategy.
	 * - 'batch': Efficient batching for long-running servers (default)
	 * - 'simple': Immediate export for serverless environments (Lambda, Edge)
	 *
	 * If not specified, automatically selected based on environment detection.
	 */
	spanProcessorStrategy?: SpanProcessorStrategy;

	/**
	 * Environment type for automatic configuration
	 * @default 'server'
	 */
	environment?: 'server' | 'lambda' | 'edge' | 'custom';
}

let sdk: NodeSDK | null = null;
let onSigterm: (() => void) | null = null;

/** A `sampleRatio` outside 0–1, which no sampler can honour. */
export class InvalidSampleRatio extends Error {
	constructor(readonly sampleRatio: number) {
		super(
			`sampleRatio must be a number from 0 (no traces) to 1 (every trace), got ${sampleRatio}. Pass a fraction such as 0.1 to keep one trace in ten.`,
		);
		this.name = 'InvalidSampleRatio';
	}
}

/** Whether the standard OTLP environment variables name a collector. */
function otlpEndpointFromEnv(signal: 'TRACES' | 'LOGS'): boolean {
	return Boolean(
		process.env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`] ||
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
	);
}

/**
 * The sampler for an explicit ratio, or for the stage's rate in
 * `OTEL_TRACES_SAMPLER_ARG` — or undefined to let the SDK read any other
 * `OTEL_TRACES_SAMPLER` itself.
 */
function samplerFor(sampleRatio: number | undefined): Sampler | undefined {
	if (sampleRatio === undefined) return traceSamplerFromEnv();
	if (!Number.isFinite(sampleRatio) || sampleRatio < 0 || sampleRatio > 1) {
		throw new InvalidSampleRatio(sampleRatio);
	}
	return traceSampler(sampleRatio);
}

/**
 * Set up OpenTelemetry instrumentation.
 * Call this BEFORE importing your application code.
 *
 * @example
 * ```typescript
 * // instrumentation.ts (create this file)
 * import { setupTelemetry } from '@geekmidas/telescope/instrumentation';
 *
 * setupTelemetry({
 *   serviceName: 'my-api',
 *   endpoint: 'http://localhost:3000/__telescope/v1',
 * });
 *
 * // Then in your entry point:
 * // import './instrumentation';
 * // import { app } from './app';
 * ```
 */
export function setupTelemetry(options: TelemetryOptions): void {
	if (sdk) {
		return;
	}

	const {
		serviceName,
		serviceVersion = '1.0.0',
		serviceNamespace,
		deploymentEnvironment,
		endpoint,
		sampleRatio,
		handleSignals = true,
		instrumentPino = true,
		incomingHttpSpans = true,
		autoInstrument = true,
		debug = false,
		resourceAttributes = {},
		headers,
		spanProcessorStrategy,
		environment = 'server',
	} = options;

	// Before anything starts, so a bad ratio leaves nothing half set up.
	const sampler = samplerFor(sampleRatio);

	// Enable debug logging if requested
	if (debug) {
		diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
	}

	// Create resource
	// `new Resource(...)` went in resources 2.x — a resource is now made from
	// attributes by a function, so a detector and a literal produce the same
	// thing rather than two shapes that had to be merged.
	//
	// The SDK merges what `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_SERVICE_NAME`
	// say over this, so an operator can still rename or relabel a service.
	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: serviceName,
		[ATTR_SERVICE_VERSION]: serviceVersion,
		...(serviceNamespace && { 'service.namespace': serviceNamespace }),
		...(deploymentEnvironment && {
			'deployment.environment.name': deploymentEnvironment,
			'deployment.environment': deploymentEnvironment,
		}),
		...resourceAttributes,
	});

	// Build instrumentations list
	const instrumentations = [];

	// Add Pino instrumentation for log correlation
	if (instrumentPino) {
		instrumentations.push(
			new PinoInstrumentation({
				// Inject trace context into log records
				logHook: (span, record) => {
					record.trace_id = span.spanContext().traceId;
					record.span_id = span.spanContext().spanId;
					record.trace_flags = span.spanContext().traceFlags;
				},
			}),
		);
	}

	// Add auto-instrumentations for common libraries
	if (autoInstrument) {
		instrumentations.push(
			getNodeAutoInstrumentations({
				// Disable file system instrumentation (too noisy)
				'@opentelemetry/instrumentation-fs': { enabled: false },
				// Configure HTTP instrumentation
				'@opentelemetry/instrumentation-http': {
					disableIncomingRequestInstrumentation: !incomingHttpSpans,
					ignoreIncomingRequestHook: (request) => {
						// Ignore health checks and internal routes
						const path = request.url || '';
						return (
							path.includes('/__health') ||
							path.includes('/__telescope') ||
							path.includes('/favicon')
						);
					},
				},
			}),
		);
	}

	// Create exporters
	let traceExporter: SpanExporter;
	if (endpoint) {
		traceExporter = new OTLPTraceExporter({
			url: `${endpoint}/traces`,
			headers: headers ?? {},
		});
	} else if (otlpEndpointFromEnv('TRACES')) {
		// No URL: the exporter reads the OTLP variables itself, the way any
		// other OpenTelemetry SDK would.
		traceExporter = new OTLPTraceExporter(headers ? { headers } : {});
	} else {
		// Fall back to console exporter for debugging
		traceExporter = new ConsoleSpanExporter();
	}

	// Determine span processor strategy
	const strategy = spanProcessorStrategy ?? getRecommendedStrategy(environment);
	const spanProcessor = createSpanProcessor(traceExporter, { strategy });

	// Register globally for flush operations
	setGlobalSpanProcessor(spanProcessor);

	// Set up log exporter if a collector is named
	let logProcessor: BatchLogRecordProcessor | undefined;
	if (endpoint || otlpEndpointFromEnv('LOGS')) {
		const logExporter = endpoint
			? new OTLPLogExporter({
					url: `${endpoint}/logs`,
					headers: headers ?? {},
				})
			: new OTLPLogExporter(headers ? { headers } : {});

		// sdk-logs 2.x: processors are constructor-only and the exporter is
		// named rather than positional.
		logProcessor = new BatchLogRecordProcessor({ exporter: logExporter });

		// Register for flush operations
		setGlobalLogProcessor(logProcessor);
	}

	// Create and configure SDK. The SDK owns the logger provider, so the log
	// processor is handed to it rather than to a provider of our own — one
	// nothing registered would never receive a record.
	sdk = new NodeSDK({
		resource,
		traceExporter,
		spanProcessors: [spanProcessor],
		...(logProcessor && { logRecordProcessors: [logProcessor] }),
		...(sampler && { sampler }),
		instrumentations,
	});

	// Start the SDK
	sdk.start();

	if (handleSignals) {
		// Graceful shutdown
		onSigterm = () => {
			sdk
				?.shutdown()
				.then(() => {})
				.catch((_error) => {})
				.finally(() => process.exit(0));
		};
		process.on('SIGTERM', onSigterm);
	}
}

/**
 * Shut down telemetry (for testing or graceful shutdown)
 */
export async function shutdownTelemetry(): Promise<void> {
	if (onSigterm) {
		process.off('SIGTERM', onSigterm);
		onSigterm = null;
	}
	if (sdk) {
		await sdk.shutdown();
		sdk = null;
	}
}
