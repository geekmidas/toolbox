import {
  type Attributes,
  type Context,
  type Span,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';

/**
 * HTTP request attributes following OpenTelemetry semantic conventions
 */
export interface HttpRequestAttributes {
  method: string;
  url?: string;
  path?: string;
  route?: string;
  host?: string;
  scheme?: 'http' | 'https';
  userAgent?: string;
  clientIp?: string;
  requestId?: string;
}

/**
 * HTTP response attributes
 */
export interface HttpResponseAttributes {
  statusCode: number;
  responseSize?: number;
}

/**
 * Endpoint-specific attributes
 */
export interface EndpointAttributes {
  name?: string;
  operationId?: string;
  tags?: string[];
}

/**
 * User/session attributes
 */
export interface UserAttributes {
  userId?: string;
  sessionId?: string;
  roles?: string[];
}

/**
 * Full span attributes for HTTP requests
 */
export interface HttpSpanAttributes extends HttpRequestAttributes {
  response?: HttpResponseAttributes;
  endpoint?: EndpointAttributes;
  user?: UserAttributes;
  custom?: Attributes;
}

const TRACER_NAME = '@geekmidas/constructs';

/**
 * Get or create a tracer for constructs instrumentation
 */
export function getConstructsTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Convert HTTP attributes to OpenTelemetry semantic conventions
 */
export function toOtelAttributes(attrs: HttpSpanAttributes): Attributes {
  const otelAttrs: Attributes = {};

  // HTTP request attributes (OpenTelemetry semantic conventions)
  if (attrs.method) otelAttrs['http.request.method'] = attrs.method;
  if (attrs.url) otelAttrs['url.full'] = attrs.url;
  if (attrs.path) otelAttrs['url.path'] = attrs.path;
  if (attrs.route) otelAttrs['http.route'] = attrs.route;
  if (attrs.host) otelAttrs['server.address'] = attrs.host;
  if (attrs.scheme) otelAttrs['url.scheme'] = attrs.scheme;
  if (attrs.userAgent) otelAttrs['user_agent.original'] = attrs.userAgent;
  if (attrs.clientIp) otelAttrs['client.address'] = attrs.clientIp;
  if (attrs.requestId) otelAttrs['http.request.id'] = attrs.requestId;

  // HTTP response attributes
  if (attrs.response?.statusCode) {
    otelAttrs['http.response.status_code'] = attrs.response.statusCode;
  }
  if (attrs.response?.responseSize) {
    otelAttrs['http.response.body.size'] = attrs.response.responseSize;
  }

  // Endpoint attributes
  if (attrs.endpoint?.name) otelAttrs['endpoint.name'] = attrs.endpoint.name;
  if (attrs.endpoint?.operationId) {
    otelAttrs['endpoint.operation_id'] = attrs.endpoint.operationId;
  }
  if (attrs.endpoint?.tags?.length) {
    otelAttrs['endpoint.tags'] = attrs.endpoint.tags;
  }

  // User attributes
  if (attrs.user?.userId) otelAttrs['enduser.id'] = attrs.user.userId;
  if (attrs.user?.sessionId) otelAttrs['session.id'] = attrs.user.sessionId;
  if (attrs.user?.roles?.length) otelAttrs['enduser.role'] = attrs.user.roles.join(',');

  // Custom attributes
  if (attrs.custom) {
    Object.assign(otelAttrs, attrs.custom);
  }

  return otelAttrs;
}

/**
 * Extract trace context from HTTP headers
 */
export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>,
): Context {
  // Normalize headers to Record<string, string>
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      normalizedHeaders[key.toLowerCase()] = Array.isArray(value)
        ? value[0]
        : value;
    }
  }

  return propagation.extract(context.active(), normalizedHeaders);
}

/**
 * Inject trace context into HTTP headers
 */
export function injectTraceContext(
  headers: Record<string, string>,
  ctx?: Context,
): Record<string, string> {
  const result = { ...headers };
  propagation.inject(ctx ?? context.active(), result);
  return result;
}

/**
 * Create an HTTP server span for an incoming request
 */
export function createHttpServerSpan(
  attrs: HttpSpanAttributes,
  parentContext?: Context,
): Span {
  const tracer = getConstructsTracer();
  const spanName = attrs.route
    ? `${attrs.method} ${attrs.route}`
    : `${attrs.method} ${attrs.path || '/'}`;

  const ctx = parentContext ?? context.active();

  return tracer.startSpan(
    spanName,
    {
      kind: SpanKind.SERVER,
      attributes: toOtelAttributes(attrs),
    },
    ctx,
  );
}

/**
 * End an HTTP span with response data
 */
export function endHttpSpan(
  span: Span,
  response: HttpResponseAttributes,
  error?: Error,
): void {
  span.setAttribute('http.response.status_code', response.statusCode);

  if (response.responseSize) {
    span.setAttribute('http.response.body.size', response.responseSize);
  }

  if (error) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  } else if (response.statusCode >= 400) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `HTTP ${response.statusCode}`,
    });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }

  span.end();
}

/**
 * Execute a function within an HTTP server span context
 *
 * @example
 * ```typescript
 * const result = await withHttpSpan(
 *   { method: 'GET', path: '/users', route: '/users' },
 *   async (span) => {
 *     const users = await getUsers();
 *     return { statusCode: 200, body: users };
 *   }
 * );
 * ```
 */
export async function withHttpSpan<T>(
  attrs: HttpSpanAttributes,
  fn: (span: Span) => Promise<T & { statusCode?: number }>,
  parentContext?: Context,
): Promise<T> {
  const span = createHttpServerSpan(attrs, parentContext);

  try {
    const result = await context.with(
      trace.setSpan(parentContext ?? context.active(), span),
      () => fn(span),
    );

    const statusCode =
      (result as { statusCode?: number }).statusCode ?? 200;
    endHttpSpan(span, { statusCode });

    return result;
  } catch (error) {
    endHttpSpan(
      span,
      { statusCode: 500 },
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

/**
 * Create a child span for internal operations (middleware, handlers, etc.)
 */
export function createChildSpan(
  name: string,
  attributes?: Attributes,
): Span {
  const tracer = getConstructsTracer();
  return tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes,
  });
}

/**
 * Execute a function within a child span
 */
export async function withChildSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const span = createChildSpan(name, attributes);

  try {
    const result = await context.with(
      trace.setSpan(context.active(), span),
      () => fn(span),
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Check if tracing is enabled (OpenTelemetry API is available and configured)
 */
export function isTracingEnabled(): boolean {
  try {
    const tracer = trace.getTracer(TRACER_NAME);
    // Check if we have a real tracer (not a no-op)
    const span = tracer.startSpan('test');
    const isReal = span.spanContext().traceId !== '00000000000000000000000000000000';
    span.end();
    return isReal;
  } catch {
    return false;
  }
}
