import { describe, expect, it } from 'vitest';
import {
  transformLogs,
  transformMetrics,
  transformTraces,
} from '../transformer';
import {
  type ExportLogsServiceRequest,
  type ExportMetricsServiceRequest,
  type ExportTraceServiceRequest,
  SeverityNumber,
  SpanKind,
  SpanStatusCode,
} from '../types';

describe('OTLP Transformer', () => {
  describe('transformTraces', () => {
    it('should transform HTTP server spans to request entries', () => {
      const request: ExportTraceServiceRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'my-api' } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: '@opentelemetry/instrumentation-http' },
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'def456',
                    name: 'GET /users',
                    kind: SpanKind.SPAN_KIND_SERVER,
                    startTimeUnixNano: '1704067200000000000', // 2024-01-01 00:00:00
                    endTimeUnixNano: '1704067200050000000', // +50ms
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'GET' } },
                      { key: 'http.target', value: { stringValue: '/users' } },
                      { key: 'http.status_code', value: { intValue: '200' } },
                      {
                        key: 'http.url',
                        value: { stringValue: 'http://localhost:3000/users' },
                      },
                    ],
                    status: { code: SpanStatusCode.STATUS_CODE_OK },
                  },
                ],
              },
            ],
          },
        ],
      };

      const entries = transformTraces(request);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        method: 'GET',
        path: '/users',
        url: 'http://localhost:3000/users',
        status: 200,
        duration: 50,
      });
      expect(entries[0].tags).toContain('trace:abc123');
      expect(entries[0].tags).toContain('span:def456');
      expect(entries[0].tags).toContain('service:my-api');
    });

    it('should ignore non-HTTP server spans', () => {
      const request: ExportTraceServiceRequest = {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'def456',
                    name: 'internal-operation',
                    kind: SpanKind.SPAN_KIND_INTERNAL,
                    startTimeUnixNano: '1704067200000000000',
                    endTimeUnixNano: '1704067200050000000',
                    attributes: [],
                  },
                  {
                    traceId: 'abc123',
                    spanId: 'ghi789',
                    name: 'db-query',
                    kind: SpanKind.SPAN_KIND_CLIENT,
                    startTimeUnixNano: '1704067200000000000',
                    endTimeUnixNano: '1704067200010000000',
                    attributes: [
                      { key: 'db.system', value: { stringValue: 'postgresql' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const entries = transformTraces(request);
      expect(entries).toHaveLength(0);
    });

    it('should handle error spans', () => {
      const request: ExportTraceServiceRequest = {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'def456',
                    name: 'POST /error',
                    kind: SpanKind.SPAN_KIND_SERVER,
                    startTimeUnixNano: '1704067200000000000',
                    endTimeUnixNano: '1704067200100000000',
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'POST' } },
                      { key: 'http.target', value: { stringValue: '/error' } },
                    ],
                    status: {
                      code: SpanStatusCode.STATUS_CODE_ERROR,
                      message: 'Internal server error',
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const entries = transformTraces(request);

      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe(500);
    });

    it('should handle empty request', () => {
      const entries = transformTraces({});
      expect(entries).toHaveLength(0);
    });

    it('should extract client IP from attributes', () => {
      const request: ExportTraceServiceRequest = {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'def456',
                    name: 'GET /test',
                    kind: SpanKind.SPAN_KIND_SERVER,
                    startTimeUnixNano: '1704067200000000000',
                    endTimeUnixNano: '1704067200050000000',
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'GET' } },
                      { key: 'http.target', value: { stringValue: '/test' } },
                      { key: 'http.status_code', value: { intValue: '200' } },
                      {
                        key: 'client.address',
                        value: { stringValue: '192.168.1.1' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const entries = transformTraces(request);
      expect(entries[0].ip).toBe('192.168.1.1');
    });
  });

  describe('transformLogs', () => {
    it('should transform log records to log entries', () => {
      const request: ExportLogsServiceRequest = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'my-api' } },
              ],
            },
            scopeLogs: [
              {
                scope: { name: 'my-logger' },
                logRecords: [
                  {
                    observedTimeUnixNano: '1704067200000000000',
                    severityNumber: SeverityNumber.SEVERITY_NUMBER_INFO,
                    severityText: 'INFO',
                    body: { stringValue: 'User logged in' },
                    attributes: [
                      { key: 'userId', value: { stringValue: '123' } },
                    ],
                    traceId: 'abc123',
                    spanId: 'def456',
                  },
                ],
              },
            ],
          },
        ],
      };

      const entries = transformLogs(request);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        level: 'info',
        message: 'User logged in',
        requestId: 'span:def456',
      });
      expect(entries[0].context).toMatchObject({
        userId: '123',
        'service.name': 'my-api',
        'instrumentation.scope': 'my-logger',
      });
    });

    it('should map severity levels correctly', () => {
      const createLogRequest = (
        severity: SeverityNumber,
      ): ExportLogsServiceRequest => ({
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    observedTimeUnixNano: '1704067200000000000',
                    severityNumber: severity,
                    body: { stringValue: 'Test message' },
                  },
                ],
              },
            ],
          },
        ],
      });

      expect(
        transformLogs(createLogRequest(SeverityNumber.SEVERITY_NUMBER_DEBUG))[0]
          .level,
      ).toBe('debug');
      expect(
        transformLogs(createLogRequest(SeverityNumber.SEVERITY_NUMBER_INFO))[0]
          .level,
      ).toBe('info');
      expect(
        transformLogs(createLogRequest(SeverityNumber.SEVERITY_NUMBER_WARN))[0]
          .level,
      ).toBe('warn');
      expect(
        transformLogs(createLogRequest(SeverityNumber.SEVERITY_NUMBER_ERROR))[0]
          .level,
      ).toBe('error');
      expect(
        transformLogs(createLogRequest(SeverityNumber.SEVERITY_NUMBER_FATAL))[0]
          .level,
      ).toBe('error');
    });

    it('should handle object body', () => {
      const request: ExportLogsServiceRequest = {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    observedTimeUnixNano: '1704067200000000000',
                    severityNumber: SeverityNumber.SEVERITY_NUMBER_INFO,
                    body: {
                      kvlistValue: {
                        values: [
                          { key: 'event', value: { stringValue: 'login' } },
                          { key: 'success', value: { boolValue: true } },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const entries = transformLogs(request);
      expect(entries[0].message).toBe('{"event":"login","success":true}');
    });

    it('should handle empty request', () => {
      const entries = transformLogs({});
      expect(entries).toHaveLength(0);
    });
  });

  describe('transformMetrics', () => {
    it('should transform gauge metrics', () => {
      const request: ExportMetricsServiceRequest = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'my-api' } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'cpu_usage',
                    description: 'CPU usage percentage',
                    unit: '%',
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: '1704067200000000000',
                          asDouble: 45.5,
                          attributes: [
                            { key: 'host', value: { stringValue: 'server-1' } },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const points = transformMetrics(request);

      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({
        name: 'cpu_usage',
        description: 'CPU usage percentage',
        unit: '%',
        value: 45.5,
        type: 'gauge',
      });
      expect(points[0].attributes).toMatchObject({ host: 'server-1' });
      expect(points[0].resourceAttributes).toMatchObject({
        'service.name': 'my-api',
      });
    });

    it('should transform sum (counter) metrics', () => {
      const request: ExportMetricsServiceRequest = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'http_requests_total',
                    sum: {
                      dataPoints: [
                        {
                          timeUnixNano: '1704067200000000000',
                          asInt: '1234',
                        },
                      ],
                      aggregationTemporality: 2, // CUMULATIVE
                      isMonotonic: true,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const points = transformMetrics(request);

      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({
        name: 'http_requests_total',
        value: 1234,
        type: 'sum',
      });
    });

    it('should transform histogram metrics', () => {
      const request: ExportMetricsServiceRequest = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'http_request_duration',
                    histogram: {
                      dataPoints: [
                        {
                          timeUnixNano: '1704067200000000000',
                          count: '100',
                          sum: 5000,
                          min: 10,
                          max: 500,
                          bucketCounts: ['10', '30', '40', '15', '5'],
                          explicitBounds: [50, 100, 200, 500],
                        },
                      ],
                      aggregationTemporality: 2,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const points = transformMetrics(request);

      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({
        name: 'http_request_duration',
        value: 5000,
        type: 'histogram',
      });
      expect(points[0].attributes).toMatchObject({
        count: 100,
        min: 10,
        max: 500,
      });
    });

    it('should handle empty request', () => {
      const points = transformMetrics({});
      expect(points).toHaveLength(0);
    });
  });
});
