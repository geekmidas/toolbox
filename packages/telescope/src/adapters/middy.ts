import type { MiddlewareObj } from '@middy/core';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Context,
} from 'aws-lambda';
import { flushTelemetry } from '../instrumentation/core';
import type { Telescope } from '../Telescope';

/**
 * Options for the Telescope Middy middleware
 */
export interface TelescopeMiddlewareOptions {
  /**
   * Minimum remaining time (ms) before forcing a flush.
   * If remaining time drops below this, flush immediately.
   * @default 1000 (1 second)
   */
  flushThresholdMs?: number;

  /**
   * Whether to record request/response bodies
   * @default true
   */
  recordBody?: boolean;

  /**
   * Timeout for flush operation in ms
   * @default 5000
   */
  flushTimeoutMs?: number;
}

// Track if we've registered the process hooks
let processHooksRegistered = false;

/**
 * Register process-level hooks for telemetry flush.
 * Called once per Lambda cold start.
 */
function registerProcessHooks(): void {
  if (processHooksRegistered) return;
  processHooksRegistered = true;

  // Flush on SIGTERM (Lambda shutdown)
  process.on('SIGTERM', async () => {
    await flushTelemetry(5000).catch(() => {});
  });

  // Note: beforeExit doesn't work reliably in Lambda
  // because Lambda freezes rather than exits
}

/**
 * Extract request data from API Gateway event (v1 or v2)
 */
function extractRequestData(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
): {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  ip?: string;
  requestId?: string;
} {
  const headers: Record<string, string> = {};
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      if (value) headers[key.toLowerCase()] = value;
    }
  }

  // API Gateway v2 (HTTP API)
  if ('rawPath' in event && event.requestContext?.http) {
    const v2Event = event as APIGatewayProxyEventV2;
    // Filter out undefined values from query parameters
    const query: Record<string, string> = {};
    if (v2Event.queryStringParameters) {
      for (const [key, value] of Object.entries(
        v2Event.queryStringParameters,
      )) {
        if (value !== undefined) {
          query[key] = value;
        }
      }
    }
    return {
      method: v2Event.requestContext.http.method,
      path: v2Event.rawPath,
      url:
        v2Event.rawPath +
        (v2Event.rawQueryString ? `?${v2Event.rawQueryString}` : ''),
      headers,
      query,
      body: parseBody(v2Event.body, v2Event.isBase64Encoded),
      ip: v2Event.requestContext.http.sourceIp,
      requestId: v2Event.requestContext.requestId,
    };
  }

  // API Gateway v1 (REST API)
  const v1Event = event as APIGatewayProxyEvent;
  const queryString = v1Event.queryStringParameters
    ? new URLSearchParams(
        v1Event.queryStringParameters as Record<string, string>,
      ).toString()
    : '';

  return {
    method: v1Event.httpMethod,
    path: v1Event.path,
    url: v1Event.path + (queryString ? `?${queryString}` : ''),
    headers,
    query: (v1Event.queryStringParameters as Record<string, string>) || {},
    body: parseBody(v1Event.body, v1Event.isBase64Encoded),
    ip: v1Event.requestContext?.identity?.sourceIp,
    requestId: v1Event.requestContext?.requestId,
  };
}

/**
 * Parse request body
 */
function parseBody(
  body: string | null | undefined,
  isBase64Encoded?: boolean,
): unknown {
  if (!body) return undefined;

  try {
    const decoded = isBase64Encoded
      ? Buffer.from(body, 'base64').toString('utf-8')
      : body;
    return JSON.parse(decoded);
  } catch {
    return body;
  }
}

/**
 * Extract response data from Lambda response
 */
function extractResponseData(response: unknown): {
  status: number;
  headers: Record<string, string>;
  body: unknown;
} {
  if (response && typeof response === 'object' && 'statusCode' in response) {
    const res = response as {
      statusCode?: number;
      headers?: Record<string, string>;
      body?: string;
    };
    return {
      status: res.statusCode || 200,
      headers: res.headers || {},
      body: res.body ? tryParseJson(res.body) : undefined,
    };
  }

  return { status: 200, headers: {}, body: response };
}

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Middy middleware that integrates Telescope with Lambda handlers.
 *
 * Features:
 * - Records all requests and responses to Telescope
 * - Captures exceptions automatically
 * - Flushes telemetry before Lambda freezes
 * - Uses Lambda context for smart flush timing
 *
 * @example
 * ```typescript
 * import middy from '@middy/core';
 * import { telescopeMiddleware } from '@geekmidas/telescope/lambda';
 *
 * const handler = middy(baseHandler)
 *   .use(telescopeMiddleware(telescope));
 * ```
 */
export function telescopeMiddleware(
  telescope: Telescope,
  options: TelescopeMiddlewareOptions = {},
): MiddlewareObj<
  APIGatewayProxyEvent | APIGatewayProxyEventV2,
  any,
  Error,
  Context
> {
  const {
    flushThresholdMs = 1000,
    recordBody = true,
    flushTimeoutMs = 5000,
  } = options;

  // Register process hooks on first use
  registerProcessHooks();

  return {
    before: async (request) => {
      // Store start time for duration calculation
      (request as any).__telescopeStartTime = Date.now();

      // Don't wait for empty event loop - we'll flush manually
      request.context.callbackWaitsForEmptyEventLoop = false;
    },

    after: async (request) => {
      const startTime = (request as any).__telescopeStartTime || Date.now();
      const duration = Date.now() - startTime;

      try {
        const reqData = extractRequestData(request.event);
        const resData = extractResponseData(request.response);

        await telescope.recordRequest({
          method: reqData.method,
          path: reqData.path,
          url: reqData.url,
          headers: reqData.headers,
          query: reqData.query,
          body: recordBody ? reqData.body : undefined,
          ip: reqData.ip,
          status: resData.status,
          responseHeaders: resData.headers,
          responseBody: recordBody ? resData.body : undefined,
          duration,
        });
      } catch {
        // Don't let telescope errors break the response
      }

      // Smart flush: check remaining time
      await smartFlush(request.context, flushThresholdMs, flushTimeoutMs);
    },

    onError: async (request) => {
      const startTime = (request as any).__telescopeStartTime || Date.now();
      const duration = Date.now() - startTime;

      try {
        // Record the exception
        if (request.error) {
          await telescope.exception(request.error);
        }

        // Also record the failed request
        const reqData = extractRequestData(request.event);
        await telescope.recordRequest({
          method: reqData.method,
          path: reqData.path,
          url: reqData.url,
          headers: reqData.headers,
          query: reqData.query,
          body: recordBody ? reqData.body : undefined,
          ip: reqData.ip,
          status: 500,
          responseHeaders: {},
          responseBody: { error: request.error?.message },
          duration,
        });
      } catch {
        // Don't let telescope errors mask the original error
      }

      // Always flush on error
      await smartFlush(request.context, flushThresholdMs, flushTimeoutMs);
    },
  };
}

/**
 * Smart flush that respects Lambda's remaining execution time
 */
async function smartFlush(
  context: Context,
  thresholdMs: number,
  timeoutMs: number,
): Promise<void> {
  const remaining = context.getRemainingTimeInMillis();

  // If we have plenty of time, use normal timeout
  // If time is running low, use a shorter timeout
  const effectiveTimeout = Math.min(
    timeoutMs,
    Math.max(remaining - thresholdMs, 100), // Leave at least threshold ms for response
  );

  if (effectiveTimeout > 0) {
    await flushTelemetry(effectiveTimeout).catch(() => {});
  }
}

/**
 * Create a wrapped Lambda handler with Telescope integration.
 * Alternative to using Middy middleware directly.
 *
 * @example
 * ```typescript
 * import { createTelescopeHandler } from '@geekmidas/telescope/lambda';
 *
 * export const handler = createTelescopeHandler(telescope, async (event, context) => {
 *   return { statusCode: 200, body: 'OK' };
 * });
 * ```
 */
export function createTelescopeHandler<TEvent, TResult>(
  telescope: Telescope,
  handler: (event: TEvent, context: Context) => Promise<TResult>,
  options: TelescopeMiddlewareOptions = {},
): (event: TEvent, context: Context) => Promise<TResult> {
  const {
    flushThresholdMs = 1000,
    recordBody = true,
    flushTimeoutMs = 5000,
  } = options;

  registerProcessHooks();

  return async (event: TEvent, context: Context): Promise<TResult> => {
    const startTime = Date.now();
    context.callbackWaitsForEmptyEventLoop = false;

    try {
      const result = await handler(event, context);
      const duration = Date.now() - startTime;

      // Record successful request
      try {
        const reqData = extractRequestData(event as any);
        const resData = extractResponseData(result);

        await telescope.recordRequest({
          method: reqData.method,
          path: reqData.path,
          url: reqData.url,
          headers: reqData.headers,
          query: reqData.query,
          body: recordBody ? reqData.body : undefined,
          ip: reqData.ip,
          status: resData.status,
          responseHeaders: resData.headers,
          responseBody: recordBody ? resData.body : undefined,
          duration,
        });
      } catch {
        // Ignore telescope errors
      }

      await smartFlush(context, flushThresholdMs, flushTimeoutMs);
      return result;
    } catch (error) {
      // Record exception
      if (error instanceof Error) {
        await telescope.exception(error).catch(() => {});
      }

      await smartFlush(context, flushThresholdMs, flushTimeoutMs);
      throw error;
    }
  };
}
