import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStorage } from '../../storage/memory';
import { Telescope } from '../../Telescope';
import { OTLPReceiver } from '../receiver';
import {
  type ExportLogsServiceRequest,
  type ExportMetricsServiceRequest,
  type ExportTraceServiceRequest,
  SeverityNumber,
  SpanKind,
  SpanStatusCode,
} from '../types';

describe('OTLPReceiver', () => {
  let telescope: Telescope;
  let storage: InMemoryStorage;
  let receiver: OTLPReceiver;

  beforeEach(() => {
    storage = new InMemoryStorage();
    telescope = new Telescope({ storage });
    receiver = new OTLPReceiver({ telescope });
  });

  afterEach(() => {
    telescope.destroy();
  });

  describe('receiveTraces', () => {
    it('should record HTTP server spans as requests', async () => {
      const request: ExportTraceServiceRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'test-api' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'def456',
                    name: 'GET /users',
                    kind: SpanKind.SPAN_KIND_SERVER,
                    startTimeUnixNano: '1704067200000000000',
                    endTimeUnixNano: '1704067200050000000',
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'GET' } },
                      { key: 'http.target', value: { stringValue: '/users' } },
                      { key: 'http.status_code', value: { intValue: '200' } },
                    ],
                    status: { code: SpanStatusCode.STATUS_CODE_OK },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await receiver.receiveTraces(request);

      expect(response.partialSuccess).toBeUndefined();

      const requests = await telescope.getRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('GET');
      expect(requests[0].path).toBe('/users');
      expect(requests[0].status).toBe(200);
    });

    it('should handle multiple spans', async () => {
      const request: ExportTraceServiceRequest = {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'span1',
                    name: 'GET /users',
                    kind: SpanKind.SPAN_KIND_SERVER,
                    startTimeUnixNano: '1704067200000000000',
                    endTimeUnixNano: '1704067200050000000',
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'GET' } },
                      { key: 'http.target', value: { stringValue: '/users' } },
                      { key: 'http.status_code', value: { intValue: '200' } },
                    ],
                  },
                  {
                    traceId: 'abc123',
                    spanId: 'span2',
                    name: 'POST /users',
                    kind: SpanKind.SPAN_KIND_SERVER,
                    startTimeUnixNano: '1704067200100000000',
                    endTimeUnixNano: '1704067200200000000',
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'POST' } },
                      { key: 'http.target', value: { stringValue: '/users' } },
                      { key: 'http.status_code', value: { intValue: '201' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      await receiver.receiveTraces(request);

      const requests = await telescope.getRequests();
      expect(requests).toHaveLength(2);
    });

    it('should return empty response for empty request', async () => {
      const response = await receiver.receiveTraces({});
      expect(response).toEqual({});
    });
  });

  describe('receiveLogs', () => {
    it('should record log entries', async () => {
      const request: ExportLogsServiceRequest = {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    observedTimeUnixNano: '1704067200000000000',
                    severityNumber: SeverityNumber.SEVERITY_NUMBER_INFO,
                    body: { stringValue: 'User logged in' },
                    attributes: [
                      { key: 'userId', value: { stringValue: '123' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await receiver.receiveLogs(request);

      expect(response.partialSuccess).toBeUndefined();

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('User logged in');
    });

    it('should batch multiple log records', async () => {
      const request: ExportLogsServiceRequest = {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    observedTimeUnixNano: '1704067200000000000',
                    severityNumber: SeverityNumber.SEVERITY_NUMBER_INFO,
                    body: { stringValue: 'Log 1' },
                  },
                  {
                    observedTimeUnixNano: '1704067200001000000',
                    severityNumber: SeverityNumber.SEVERITY_NUMBER_DEBUG,
                    body: { stringValue: 'Log 2' },
                  },
                  {
                    observedTimeUnixNano: '1704067200002000000',
                    severityNumber: SeverityNumber.SEVERITY_NUMBER_WARN,
                    body: { stringValue: 'Log 3' },
                  },
                ],
              },
            ],
          },
        ],
      };

      await receiver.receiveLogs(request);

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(3);
    });

    it('should return empty response for empty request', async () => {
      const response = await receiver.receiveLogs({});
      expect(response).toEqual({});
    });
  });

  describe('receiveMetrics', () => {
    it('should call onMetrics handler', async () => {
      const onMetrics = vi.fn();
      const receiverWithHandler = new OTLPReceiver({
        telescope,
        onMetrics,
      });

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
                          asInt: '100',
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

      const response = await receiverWithHandler.receiveMetrics(request);

      expect(response.partialSuccess).toBeUndefined();
      expect(onMetrics).toHaveBeenCalledTimes(1);
      expect(onMetrics).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'http_requests_total',
            value: 100,
            type: 'sum',
          }),
        ]),
      );
    });

    it('should log metrics when logMetrics is enabled', async () => {
      const receiverWithLogging = new OTLPReceiver({
        telescope,
        logMetrics: true,
      });

      const request: ExportMetricsServiceRequest = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'cpu_usage',
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: '1704067200000000000',
                          asDouble: 45.5,
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

      await receiverWithLogging.receiveMetrics(request);

      const logs = await telescope.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('OTLP Metric: cpu_usage');
      expect(logs[0].level).toBe('debug');
    });

    it('should return empty response when no handler', async () => {
      const response = await receiver.receiveMetrics({});
      expect(response).toEqual({});
    });

    it('should report partial success on handler error', async () => {
      const onMetrics = vi.fn().mockRejectedValue(new Error('Handler failed'));
      const receiverWithHandler = new OTLPReceiver({
        telescope,
        onMetrics,
      });

      const request: ExportMetricsServiceRequest = {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'test_metric',
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: '1704067200000000000',
                          asDouble: 1,
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

      const response = await receiverWithHandler.receiveMetrics(request);

      expect(response.partialSuccess).toBeDefined();
      expect(response.partialSuccess?.rejectedDataPoints).toBe('1');
    });
  });

  describe('integration with Telescope', () => {
    it('should update metrics aggregator via recordRequest', async () => {
      const request: ExportTraceServiceRequest = {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'abc123',
                    spanId: 'def456',
                    name: 'GET /api/test',
                    kind: SpanKind.SPAN_KIND_SERVER,
                    startTimeUnixNano: '1704067200000000000',
                    endTimeUnixNano: '1704067200100000000',
                    attributes: [
                      { key: 'http.method', value: { stringValue: 'GET' } },
                      {
                        key: 'http.target',
                        value: { stringValue: '/api/test' },
                      },
                      { key: 'http.status_code', value: { intValue: '200' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      await receiver.receiveTraces(request);

      // The Telescope's metrics aggregator should have the request
      const metrics = telescope.getMetrics();
      expect(metrics.totalRequests).toBe(1);
    });
  });
});
