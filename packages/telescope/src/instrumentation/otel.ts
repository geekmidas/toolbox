/**
 * OpenTelemetry implementation of the Telemetry interface
 *
 * This provides automatic span creation for Lambda handlers using
 * OpenTelemetry. Works with any OTel-compatible backend (Jaeger, Zipkin,
 * Datadog, Honeycomb, etc.)
 */
import { type Span, trace } from '@opentelemetry/api';
import type { Context as LambdaContext } from 'aws-lambda';

/**
 * Context object returned by onRequestStart, passed to subsequent hooks.
 * This matches the Telemetry interface from @geekmidas/constructs.
 */
export interface TelemetryContext {
  [key: string]: unknown;
}

/**
 * Request information passed to telemetry hooks.
 * This matches the Telemetry interface from @geekmidas/constructs.
 */
export interface TelemetryRequest {
  event: any;
  context: LambdaContext;
}

/**
 * Response information passed to onRequestEnd.
 * This matches the Telemetry interface from @geekmidas/constructs.
 */
export interface TelemetryResponse {
  statusCode: number;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * Telemetry interface for instrumenting endpoint requests.
 * This matches the Telemetry interface from @geekmidas/constructs.
 */
export interface Telemetry {
  onRequestStart(request: TelemetryRequest): TelemetryContext;
  onRequestEnd(ctx: TelemetryContext, response: TelemetryResponse): void;
  onRequestError(ctx: TelemetryContext, error: Error): void;
}

import {
  createHttpServerSpan,
  endHttpSpan,
  extractTraceContext,
  type HttpSpanAttributes,
} from './http';

/**
 * Options for OTelTelemetry
 */
export interface OTelTelemetryOptions {
  /**
   * Whether to record request body as span attribute
   * @default false
   */
  recordBody?: boolean;

  /**
   * Whether to record response body as span attribute
   * @default false
   */
  recordResponseBody?: boolean;

  /**
   * Custom function to extract user ID from event
   */
  getUserId?: (event: any) => string | undefined;

  /**
   * Custom function to extract endpoint name from event
   */
  getEndpointName?: (event: any) => string | undefined;

  /**
   * Custom function to extract operation ID from event
   */
  getOperationId?: (event: any) => string | undefined;
}

/**
 * Telemetry context with span reference
 */
interface OTelContext extends TelemetryContext {
  span: Span;
  otelContext: any;
}

/**
 * OpenTelemetry implementation of the Telemetry interface
 *
 * @example
 * ```typescript
 * import { OTelTelemetry } from '@geekmidas/telescope/instrumentation';
 *
 * const adaptor = new AmazonApiGatewayV2Endpoint(envParser, endpoint, {
 *   telemetry: new OTelTelemetry(),
 * });
 * ```
 *
 * @example With options
 * ```typescript
 * const adaptor = new AmazonApiGatewayV2Endpoint(envParser, endpoint, {
 *   telemetry: new OTelTelemetry({
 *     recordBody: true,
 *     getUserId: (event) => event.requestContext?.authorizer?.userId,
 *   }),
 * });
 * ```
 */
export class OTelTelemetry implements Telemetry {
  constructor(private options: OTelTelemetryOptions = {}) {}

  onRequestStart(request: TelemetryRequest): TelemetryContext {
    const { event, context: lambdaContext } = request;

    // Extract trace context from headers
    const headers = normalizeHeaders(event.headers || {});
    const parentContext = extractTraceContext(headers);

    // Build span attributes from event
    const attrs = this.buildSpanAttributes(event, lambdaContext);

    // Create the span
    const span = createHttpServerSpan(attrs, parentContext);
    const otelContext = trace.setSpan(parentContext, span);

    // Add Lambda-specific attributes
    span.setAttribute('faas.invocation_id', lambdaContext.awsRequestId);
    span.setAttribute('faas.name', lambdaContext.functionName);

    // Record body if requested
    if (this.options.recordBody && event.body) {
      const bodyStr =
        typeof event.body === 'string'
          ? event.body
          : JSON.stringify(event.body);
      span.setAttribute(
        'http.request.body',
        bodyStr.length > 4096 ? `${bodyStr.slice(0, 4096)}...` : bodyStr,
      );
    }

    return { span, otelContext } as OTelContext;
  }

  onRequestEnd(ctx: TelemetryContext, response: TelemetryResponse): void {
    const { span } = ctx as OTelContext;

    if (this.options.recordResponseBody && response.body) {
      span.setAttribute(
        'http.response.body',
        response.body.length > 4096
          ? `${response.body.slice(0, 4096)}...`
          : response.body,
      );
    }

    endHttpSpan(span, { statusCode: response.statusCode });
  }

  onRequestError(ctx: TelemetryContext, error: Error): void {
    const { span } = ctx as OTelContext;
    endHttpSpan(span, { statusCode: 500 }, error);
  }

  /**
   * Build span attributes from Lambda event
   */
  private buildSpanAttributes(
    event: any,
    lambdaContext: any,
  ): HttpSpanAttributes {
    // Detect event type (API Gateway v1, v2, ALB, or direct invoke)
    const isV2 =
      'requestContext' in event && 'http' in (event.requestContext || {});
    const isV1 =
      'requestContext' in event &&
      'httpMethod' in event &&
      !('http' in (event.requestContext || {}));

    let method = 'INVOKE';
    let path = '/';
    let route: string | undefined;
    let host: string | undefined;
    let scheme: 'http' | 'https' | undefined;
    let userAgent: string | undefined;
    let clientIp: string | undefined;
    let requestId: string | undefined;

    if (isV2) {
      // API Gateway v2 (HTTP API)
      const http = event.requestContext.http;
      method = http.method;
      path = event.rawPath || http.path;
      route = event.routeKey?.replace(/^[A-Z]+\s+/, ''); // Remove HTTP method prefix
      host = event.headers?.host;
      scheme = 'https';
      userAgent = http.userAgent;
      clientIp = http.sourceIp;
      requestId = event.requestContext.requestId;
    } else if (isV1) {
      // API Gateway v1 (REST API)
      method = event.httpMethod;
      path = event.path;
      route = event.resource;
      host = event.headers?.Host || event.headers?.host;
      scheme = 'https';
      userAgent =
        event.headers?.['User-Agent'] || event.headers?.['user-agent'];
      clientIp = event.requestContext?.identity?.sourceIp;
      requestId = event.requestContext?.requestId;
    } else if ('httpMethod' in event) {
      // ALB event
      method = event.httpMethod;
      path = event.path;
      host = event.headers?.host;
      userAgent =
        event.headers?.['user-agent'] || event.headers?.['User-Agent'];
      clientIp = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
    }

    const attrs: HttpSpanAttributes = {
      method,
      path,
      route,
      host,
      scheme,
      userAgent,
      clientIp,
      requestId: requestId || lambdaContext.awsRequestId,
    };

    // Add endpoint metadata if extractors provided
    if (this.options.getEndpointName || this.options.getOperationId) {
      attrs.endpoint = {
        name: this.options.getEndpointName?.(event),
        operationId: this.options.getOperationId?.(event),
      };
    }

    // Add user metadata if extractor provided
    if (this.options.getUserId) {
      const userId = this.options.getUserId(event);
      if (userId) {
        attrs.user = { userId };
      }
    }

    return attrs;
  }
}

/**
 * Normalize headers to lowercase keys
 */
function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}
