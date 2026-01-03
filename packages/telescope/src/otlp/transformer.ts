import type { LogEntry, RequestEntry } from '../types';
import {
  type AnyValue,
  type ExportLogsServiceRequest,
  type ExportMetricsServiceRequest,
  type ExportTraceServiceRequest,
  type KeyValue,
  type LogRecord,
  SeverityNumber,
  type Span,
  SpanKind,
  SpanStatusCode,
} from './types';

/**
 * Extract a primitive value from an AnyValue
 */
function extractValue(value?: AnyValue): unknown {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return parseInt(value.intValue, 10);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue) return value.arrayValue.values.map(extractValue);
  if (value.kvlistValue) return attributesToObject(value.kvlistValue.values);
  return undefined;
}

/**
 * Convert KeyValue array to a plain object
 */
function attributesToObject(attrs?: KeyValue[]): Record<string, unknown> {
  if (!attrs) return {};
  const result: Record<string, unknown> = {};
  for (const attr of attrs) {
    result[attr.key] = extractValue(attr.value);
  }
  return result;
}

/**
 * Convert nanoseconds string to Date
 */
function nanoToDate(nanoStr: string): Date {
  const nano = BigInt(nanoStr);
  const ms = Number(nano / BigInt(1_000_000));
  return new Date(ms);
}

/**
 * Convert nanoseconds string to milliseconds number
 */
function nanoToMs(nanoStr: string): number {
  const nano = BigInt(nanoStr);
  return Number(nano / BigInt(1_000_000));
}

/**
 * Map OTLP severity number to Telescope log level
 */
function mapSeverity(
  severity?: SeverityNumber,
): 'debug' | 'info' | 'warn' | 'error' {
  if (severity === undefined) return 'info';
  if (severity <= SeverityNumber.SEVERITY_NUMBER_DEBUG4) return 'debug';
  if (severity <= SeverityNumber.SEVERITY_NUMBER_INFO4) return 'info';
  if (severity <= SeverityNumber.SEVERITY_NUMBER_WARN4) return 'warn';
  return 'error';
}

/**
 * Determine HTTP status from span attributes and status
 */
function getHttpStatus(span: Span): number {
  const attrs = attributesToObject(span.attributes);

  // Look for HTTP status code in various attribute names
  const statusCode =
    attrs['http.status_code'] ??
    attrs['http.response.status_code'] ??
    attrs['http.response_status_code'];

  if (typeof statusCode === 'number') return statusCode;
  if (typeof statusCode === 'string') return parseInt(statusCode, 10) || 200;

  // Fall back to span status
  if (span.status?.code === SpanStatusCode.STATUS_CODE_ERROR) return 500;
  if (span.status?.code === SpanStatusCode.STATUS_CODE_OK) return 200;

  return 200;
}

/**
 * Check if a span represents an HTTP server request
 */
function isHttpServerSpan(span: Span): boolean {
  if (span.kind !== SpanKind.SPAN_KIND_SERVER) return false;

  const attrs = attributesToObject(span.attributes);
  return !!(
    attrs['http.method'] ||
    attrs['http.request.method'] ||
    attrs['http.url'] ||
    attrs['http.target'] ||
    attrs['url.path']
  );
}

/**
 * Transform HTTP-related span attributes to RequestEntry format
 */
function transformHttpSpan(
  span: Span,
  resourceAttrs: Record<string, unknown>,
): Omit<RequestEntry, 'id' | 'timestamp'> {
  const attrs = attributesToObject(span.attributes);

  // Extract HTTP method
  const method = String(
    attrs['http.method'] ?? attrs['http.request.method'] ?? 'GET',
  ).toUpperCase();

  // Extract path
  const path = String(
    attrs['http.target'] ?? attrs['url.path'] ?? attrs['http.route'] ?? '/',
  );

  // Extract full URL
  const url = String(
    attrs['http.url'] ?? attrs['url.full'] ?? `http://localhost${path}`,
  );

  // Extract headers (if available)
  const headers: Record<string, string> = {};
  const userAgent = attrs['http.user_agent'] ?? attrs['user_agent.original'];
  if (userAgent) headers['user-agent'] = String(userAgent);

  const contentType = attrs['http.request.header.content_type'];
  if (contentType) headers['content-type'] = String(contentType);

  // Calculate duration
  const startTime = nanoToMs(span.startTimeUnixNano);
  const endTime = nanoToMs(span.endTimeUnixNano);
  const duration = endTime - startTime;

  // Get status code
  const status = getHttpStatus(span);

  // Extract client IP
  const ip =
    attrs['net.peer.ip'] ?? attrs['client.address'] ?? attrs['http.client_ip'];

  return {
    method,
    path,
    url,
    headers,
    query: {},
    status,
    responseHeaders: {},
    duration,
    ip: ip ? String(ip) : undefined,
    tags: [
      `trace:${span.traceId}`,
      `span:${span.spanId}`,
      ...(resourceAttrs['service.name']
        ? [`service:${resourceAttrs['service.name']}`]
        : []),
    ],
  };
}

/**
 * Transform OTLP traces to Telescope RequestEntries
 * Only transforms HTTP server spans to request entries
 */
export function transformTraces(
  request: ExportTraceServiceRequest,
): Array<Omit<RequestEntry, 'id' | 'timestamp'>> {
  const entries: Array<Omit<RequestEntry, 'id' | 'timestamp'>> = [];

  for (const resourceSpans of request.resourceSpans ?? []) {
    const resourceAttrs = attributesToObject(
      resourceSpans.resource?.attributes,
    );

    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) {
        // Only transform HTTP server spans
        if (isHttpServerSpan(span)) {
          entries.push(transformHttpSpan(span, resourceAttrs));
        }
      }
    }
  }

  return entries;
}

/**
 * Transform a single OTLP log record to Telescope LogEntry
 */
function transformLogRecord(
  record: LogRecord,
  resourceAttrs: Record<string, unknown>,
  scopeName?: string,
): Omit<LogEntry, 'id' | 'timestamp'> {
  const attrs = attributesToObject(record.attributes);

  // Extract message from body
  let message = '';
  if (record.body) {
    const bodyValue = extractValue(record.body);
    message =
      typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
  }

  // Build context from attributes
  const context: Record<string, unknown> = {
    ...attrs,
    ...resourceAttrs,
  };

  if (scopeName) {
    context['instrumentation.scope'] = scopeName;
  }

  // Add severity text if present
  if (record.severityText) {
    context['severity.text'] = record.severityText;
  }

  return {
    level: mapSeverity(record.severityNumber),
    message,
    context: Object.keys(context).length > 0 ? context : undefined,
    requestId: record.spanId ? `span:${record.spanId}` : undefined,
  };
}

/**
 * Transform OTLP logs to Telescope LogEntries
 */
export function transformLogs(
  request: ExportLogsServiceRequest,
): Array<Omit<LogEntry, 'id' | 'timestamp'>> {
  const entries: Array<Omit<LogEntry, 'id' | 'timestamp'>> = [];

  for (const resourceLogs of request.resourceLogs ?? []) {
    const resourceAttrs = attributesToObject(resourceLogs.resource?.attributes);

    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      const scopeName = scopeLogs.scope?.name;

      for (const record of scopeLogs.logRecords ?? []) {
        entries.push(transformLogRecord(record, resourceAttrs, scopeName));
      }
    }
  }

  return entries;
}

/**
 * Extracted metric data point for recording
 */
export interface MetricDataPoint {
  name: string;
  description?: string;
  unit?: string;
  value: number;
  timestamp: Date;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
  type: 'gauge' | 'sum' | 'histogram' | 'summary';
}

/**
 * Transform OTLP metrics to normalized data points
 * These can be used for custom metrics processing or forwarding
 */
export function transformMetrics(
  request: ExportMetricsServiceRequest,
): MetricDataPoint[] {
  const points: MetricDataPoint[] = [];

  for (const resourceMetrics of request.resourceMetrics ?? []) {
    const resourceAttrs = attributesToObject(
      resourceMetrics.resource?.attributes,
    );

    for (const scopeMetrics of resourceMetrics.scopeMetrics ?? []) {
      for (const metric of scopeMetrics.metrics ?? []) {
        const baseMeta = {
          name: metric.name,
          description: metric.description,
          unit: metric.unit,
          resourceAttributes: resourceAttrs,
        };

        // Handle gauge
        if (metric.gauge) {
          for (const dp of metric.gauge.dataPoints) {
            points.push({
              ...baseMeta,
              value: dp.asDouble ?? (dp.asInt ? parseInt(dp.asInt, 10) : 0),
              timestamp: nanoToDate(dp.timeUnixNano),
              attributes: attributesToObject(dp.attributes),
              type: 'gauge',
            });
          }
        }

        // Handle sum (counter)
        if (metric.sum) {
          for (const dp of metric.sum.dataPoints) {
            points.push({
              ...baseMeta,
              value: dp.asDouble ?? (dp.asInt ? parseInt(dp.asInt, 10) : 0),
              timestamp: nanoToDate(dp.timeUnixNano),
              attributes: attributesToObject(dp.attributes),
              type: 'sum',
            });
          }
        }

        // Handle histogram (extract sum as the value)
        if (metric.histogram) {
          for (const dp of metric.histogram.dataPoints) {
            points.push({
              ...baseMeta,
              value: dp.sum ?? 0,
              timestamp: nanoToDate(dp.timeUnixNano),
              attributes: {
                ...attributesToObject(dp.attributes),
                count: parseInt(dp.count, 10),
                min: dp.min,
                max: dp.max,
              },
              type: 'histogram',
            });
          }
        }

        // Handle summary
        if (metric.summary) {
          for (const dp of metric.summary.dataPoints) {
            points.push({
              ...baseMeta,
              value: dp.sum ?? 0,
              timestamp: nanoToDate(dp.timeUnixNano),
              attributes: {
                ...attributesToObject(dp.attributes),
                count: parseInt(dp.count, 10),
                quantiles: dp.quantileValues,
              },
              type: 'summary',
            });
          }
        }
      }
    }
  }

  return points;
}
