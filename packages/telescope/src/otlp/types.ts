/**
 * OTLP JSON types based on OpenTelemetry Protocol specification.
 * These types represent the JSON encoding of OTLP protobuf messages.
 * @see https://opentelemetry.io/docs/specs/otlp/
 */

// ============================================
// Common Types
// ============================================

/**
 * Key-value pair for attributes
 */
export interface KeyValue {
  key: string;
  value: AnyValue;
}

/**
 * Any value type (string, bool, int, double, array, kvlist, bytes)
 */
export interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string; // int64 as string
  doubleValue?: number;
  arrayValue?: ArrayValue;
  kvlistValue?: KeyValueList;
  bytesValue?: string; // base64 encoded
}

export interface ArrayValue {
  values: AnyValue[];
}

export interface KeyValueList {
  values: KeyValue[];
}

/**
 * Resource represents the entity producing telemetry
 */
export interface Resource {
  attributes?: KeyValue[];
  droppedAttributesCount?: number;
}

/**
 * InstrumentationScope represents the instrumentation library
 */
export interface InstrumentationScope {
  name: string;
  version?: string;
  attributes?: KeyValue[];
  droppedAttributesCount?: number;
}

// ============================================
// Trace Types
// ============================================

/**
 * Root message for trace export
 */
export interface ExportTraceServiceRequest {
  resourceSpans?: ResourceSpans[];
}

export interface ResourceSpans {
  resource?: Resource;
  scopeSpans?: ScopeSpans[];
  schemaUrl?: string;
}

export interface ScopeSpans {
  scope?: InstrumentationScope;
  spans?: Span[];
  schemaUrl?: string;
}

export interface Span {
  traceId: string; // hex encoded 16 bytes
  spanId: string; // hex encoded 8 bytes
  traceState?: string;
  parentSpanId?: string; // hex encoded 8 bytes
  flags?: number;
  name: string;
  kind?: SpanKind;
  startTimeUnixNano: string; // uint64 as string
  endTimeUnixNano: string; // uint64 as string
  attributes?: KeyValue[];
  droppedAttributesCount?: number;
  events?: SpanEvent[];
  droppedEventsCount?: number;
  links?: SpanLink[];
  droppedLinksCount?: number;
  status?: SpanStatus;
}

export enum SpanKind {
  SPAN_KIND_UNSPECIFIED = 0,
  SPAN_KIND_INTERNAL = 1,
  SPAN_KIND_SERVER = 2,
  SPAN_KIND_CLIENT = 3,
  SPAN_KIND_PRODUCER = 4,
  SPAN_KIND_CONSUMER = 5,
}

export interface SpanEvent {
  timeUnixNano: string;
  name: string;
  attributes?: KeyValue[];
  droppedAttributesCount?: number;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  traceState?: string;
  attributes?: KeyValue[];
  droppedAttributesCount?: number;
  flags?: number;
}

export interface SpanStatus {
  message?: string;
  code?: SpanStatusCode;
}

export enum SpanStatusCode {
  STATUS_CODE_UNSET = 0,
  STATUS_CODE_OK = 1,
  STATUS_CODE_ERROR = 2,
}

// ============================================
// Log Types
// ============================================

/**
 * Root message for log export
 */
export interface ExportLogsServiceRequest {
  resourceLogs?: ResourceLogs[];
}

export interface ResourceLogs {
  resource?: Resource;
  scopeLogs?: ScopeLogs[];
  schemaUrl?: string;
}

export interface ScopeLogs {
  scope?: InstrumentationScope;
  logRecords?: LogRecord[];
  schemaUrl?: string;
}

export interface LogRecord {
  timeUnixNano?: string;
  observedTimeUnixNano: string;
  severityNumber?: SeverityNumber;
  severityText?: string;
  body?: AnyValue;
  attributes?: KeyValue[];
  droppedAttributesCount?: number;
  flags?: number;
  traceId?: string;
  spanId?: string;
}

export enum SeverityNumber {
  SEVERITY_NUMBER_UNSPECIFIED = 0,
  SEVERITY_NUMBER_TRACE = 1,
  SEVERITY_NUMBER_TRACE2 = 2,
  SEVERITY_NUMBER_TRACE3 = 3,
  SEVERITY_NUMBER_TRACE4 = 4,
  SEVERITY_NUMBER_DEBUG = 5,
  SEVERITY_NUMBER_DEBUG2 = 6,
  SEVERITY_NUMBER_DEBUG3 = 7,
  SEVERITY_NUMBER_DEBUG4 = 8,
  SEVERITY_NUMBER_INFO = 9,
  SEVERITY_NUMBER_INFO2 = 10,
  SEVERITY_NUMBER_INFO3 = 11,
  SEVERITY_NUMBER_INFO4 = 12,
  SEVERITY_NUMBER_WARN = 13,
  SEVERITY_NUMBER_WARN2 = 14,
  SEVERITY_NUMBER_WARN3 = 15,
  SEVERITY_NUMBER_WARN4 = 16,
  SEVERITY_NUMBER_ERROR = 17,
  SEVERITY_NUMBER_ERROR2 = 18,
  SEVERITY_NUMBER_ERROR3 = 19,
  SEVERITY_NUMBER_ERROR4 = 20,
  SEVERITY_NUMBER_FATAL = 21,
  SEVERITY_NUMBER_FATAL2 = 22,
  SEVERITY_NUMBER_FATAL3 = 23,
  SEVERITY_NUMBER_FATAL4 = 24,
}

// ============================================
// Metrics Types
// ============================================

/**
 * Root message for metrics export
 */
export interface ExportMetricsServiceRequest {
  resourceMetrics?: ResourceMetrics[];
}

export interface ResourceMetrics {
  resource?: Resource;
  scopeMetrics?: ScopeMetrics[];
  schemaUrl?: string;
}

export interface ScopeMetrics {
  scope?: InstrumentationScope;
  metrics?: Metric[];
  schemaUrl?: string;
}

export interface Metric {
  name: string;
  description?: string;
  unit?: string;
  metadata?: KeyValue[];
  gauge?: Gauge;
  sum?: Sum;
  histogram?: Histogram;
  exponentialHistogram?: ExponentialHistogram;
  summary?: Summary;
}

export interface Gauge {
  dataPoints: NumberDataPoint[];
}

export interface Sum {
  dataPoints: NumberDataPoint[];
  aggregationTemporality: AggregationTemporality;
  isMonotonic?: boolean;
}

export interface Histogram {
  dataPoints: HistogramDataPoint[];
  aggregationTemporality: AggregationTemporality;
}

export interface ExponentialHistogram {
  dataPoints: ExponentialHistogramDataPoint[];
  aggregationTemporality: AggregationTemporality;
}

export interface Summary {
  dataPoints: SummaryDataPoint[];
}

export enum AggregationTemporality {
  AGGREGATION_TEMPORALITY_UNSPECIFIED = 0,
  AGGREGATION_TEMPORALITY_DELTA = 1,
  AGGREGATION_TEMPORALITY_CUMULATIVE = 2,
}

export interface NumberDataPoint {
  attributes?: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  asDouble?: number;
  asInt?: string;
  exemplars?: Exemplar[];
  flags?: number;
}

export interface HistogramDataPoint {
  attributes?: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  count: string;
  sum?: number;
  bucketCounts?: string[];
  explicitBounds?: number[];
  exemplars?: Exemplar[];
  flags?: number;
  min?: number;
  max?: number;
}

export interface ExponentialHistogramDataPoint {
  attributes?: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  count: string;
  sum?: number;
  scale?: number;
  zeroCount?: string;
  positive?: Buckets;
  negative?: Buckets;
  flags?: number;
  exemplars?: Exemplar[];
  min?: number;
  max?: number;
  zeroThreshold?: number;
}

export interface Buckets {
  offset?: number;
  bucketCounts?: string[];
}

export interface SummaryDataPoint {
  attributes?: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano: string;
  count: string;
  sum?: number;
  quantileValues?: ValueAtQuantile[];
  flags?: number;
}

export interface ValueAtQuantile {
  quantile: number;
  value: number;
}

export interface Exemplar {
  filteredAttributes?: KeyValue[];
  timeUnixNano: string;
  asDouble?: number;
  asInt?: string;
  spanId?: string;
  traceId?: string;
}

// ============================================
// Response Types
// ============================================

export interface ExportTraceServiceResponse {
  partialSuccess?: ExportTracePartialSuccess;
}

export interface ExportTracePartialSuccess {
  rejectedSpans?: string;
  errorMessage?: string;
}

export interface ExportLogsServiceResponse {
  partialSuccess?: ExportLogsPartialSuccess;
}

export interface ExportLogsPartialSuccess {
  rejectedLogRecords?: string;
  errorMessage?: string;
}

export interface ExportMetricsServiceResponse {
  partialSuccess?: ExportMetricsPartialSuccess;
}

export interface ExportMetricsPartialSuccess {
  rejectedDataPoints?: string;
  errorMessage?: string;
}
