import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { Resource } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

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
   * OTLP endpoint URL (e.g., 'http://localhost:3000/__telescope/v1')
   * If not provided, traces will be logged to console
   */
  endpoint?: string;

  /**
   * Whether to instrument Pino for log correlation
   * @default true
   */
  instrumentPino?: boolean;

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
}

let sdk: NodeSDK | null = null;

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
    console.warn('Telemetry already initialized');
    return;
  }

  const {
    serviceName,
    serviceVersion = '1.0.0',
    endpoint,
    instrumentPino = true,
    autoInstrument = true,
    debug = false,
    resourceAttributes = {},
    headers = {},
  } = options;

  // Enable debug logging if requested
  if (debug) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  // Create resource
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
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
          record['trace_id'] = span.spanContext().traceId;
          record['span_id'] = span.spanContext().spanId;
          record['trace_flags'] = span.spanContext().traceFlags;
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
  let traceExporter;
  if (endpoint) {
    traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/traces`,
      headers,
    });
  } else {
    // Fall back to console exporter for debugging
    traceExporter = new ConsoleSpanExporter();
  }

  // Create and configure SDK
  sdk = new NodeSDK({
    resource,
    traceExporter,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
    instrumentations,
  });

  // Set up log exporter if endpoint is provided
  if (endpoint) {
    const logExporter = new OTLPLogExporter({
      url: `${endpoint}/logs`,
      headers,
    });

    const loggerProvider = new LoggerProvider({ resource });
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(logExporter),
    );
  }

  // Start the SDK
  sdk.start();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      ?.shutdown()
      .then(() => )
      .catch((error) => console.error('Error shutting down telemetry', error))
      .finally(() => process.exit(0));
  });
}

/**
 * Shut down telemetry (for testing or graceful shutdown)
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
