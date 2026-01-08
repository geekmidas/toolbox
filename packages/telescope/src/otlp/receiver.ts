import type { Telescope } from '../Telescope';
import {
	type MetricDataPoint,
	transformLogs,
	transformMetrics,
	transformTraces,
} from './transformer';
import type {
	ExportLogsServiceRequest,
	ExportLogsServiceResponse,
	ExportMetricsServiceRequest,
	ExportMetricsServiceResponse,
	ExportTraceServiceRequest,
	ExportTraceServiceResponse,
} from './types';

/**
 * Callback for handling OTLP metrics
 */
export type MetricsHandler = (
	points: MetricDataPoint[],
) => void | Promise<void>;

/**
 * Options for OTLPReceiver
 */
export interface OTLPReceiverOptions {
	/**
	 * The Telescope instance to record data to
	 */
	telescope: Telescope;

	/**
	 * Optional callback for handling OTLP metrics.
	 * OTLP metrics are more granular than Telescope's request metrics,
	 * so a custom handler allows integration with metrics systems like Prometheus.
	 */
	onMetrics?: MetricsHandler;

	/**
	 * Whether to also log OTLP metrics to Telescope as log entries.
	 * Useful for debugging OTLP integration. Default: false
	 */
	logMetrics?: boolean;
}

/**
 * OTLP Receiver for ingesting OpenTelemetry data into Telescope.
 *
 * Supports the OTLP/JSON protocol for:
 * - Traces (POST /v1/traces) - HTTP server spans become RequestEntries
 * - Logs (POST /v1/logs) - Log records become LogEntries
 * - Metrics (POST /v1/metrics) - Metrics can be forwarded to custom handlers
 */
export class OTLPReceiver {
	private telescope: Telescope;
	private onMetrics?: MetricsHandler;
	private logMetrics: boolean;

	constructor(options: OTLPReceiverOptions) {
		this.telescope = options.telescope;
		this.onMetrics = options.onMetrics;
		this.logMetrics = options.logMetrics ?? false;
	}

	/**
	 * Handle incoming trace data
	 * Transforms HTTP server spans to Telescope request entries
	 */
	async receiveTraces(
		request: ExportTraceServiceRequest,
	): Promise<ExportTraceServiceResponse> {
		const entries = transformTraces(request);
		let rejected = 0;

		for (const entry of entries) {
			try {
				await this.telescope.recordRequest(entry);
			} catch {
				rejected++;
			}
		}

		return rejected > 0
			? { partialSuccess: { rejectedSpans: String(rejected) } }
			: {};
	}

	/**
	 * Handle incoming log data
	 * Transforms OTLP log records to Telescope log entries
	 */
	async receiveLogs(
		request: ExportLogsServiceRequest,
	): Promise<ExportLogsServiceResponse> {
		const entries = transformLogs(request);
		let rejected = 0;

		// Batch log entries for efficiency
		const batchEntries = entries.map((entry) => ({
			level: entry.level,
			message: entry.message,
			context: entry.context,
			requestId: entry.requestId,
		}));

		try {
			await this.telescope.log(batchEntries);
		} catch {
			rejected = entries.length;
		}

		return rejected > 0
			? { partialSuccess: { rejectedLogRecords: String(rejected) } }
			: {};
	}

	/**
	 * Handle incoming metrics data
	 * Forwards to custom handler and optionally logs to Telescope
	 */
	async receiveMetrics(
		request: ExportMetricsServiceRequest,
	): Promise<ExportMetricsServiceResponse> {
		const points = transformMetrics(request);
		let rejected = 0;

		// Forward to custom metrics handler
		if (this.onMetrics) {
			try {
				await this.onMetrics(points);
			} catch {
				rejected = points.length;
			}
		}

		// Optionally log metrics to Telescope for debugging
		if (this.logMetrics && points.length > 0) {
			const logEntries = points.map((point) => ({
				level: 'debug' as const,
				message: `OTLP Metric: ${point.name}`,
				context: {
					name: point.name,
					value: point.value,
					type: point.type,
					unit: point.unit,
					attributes: point.attributes,
				},
			}));

			try {
				await this.telescope.log(logEntries);
			} catch {
				// Ignore logging errors
			}
		}

		return rejected > 0
			? { partialSuccess: { rejectedDataPoints: String(rejected) } }
			: {};
	}
}
