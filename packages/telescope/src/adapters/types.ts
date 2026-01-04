import type { Context as HonoContext } from 'hono';

/**
 * Environment types for adapter configuration
 */
export type TelescopeEnvironment = 'server' | 'lambda' | 'edge' | 'custom';

/**
 * Request context passed to adapters
 */
export interface AdapterRequestContext {
  /** Unique request ID */
  id: string;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Full URL */
  url: string;
  /** Request headers */
  headers: Record<string, string>;
  /** Query parameters */
  query: Record<string, string>;
  /** Request body (if recorded) */
  body?: unknown;
  /** Client IP address */
  ip?: string;
  /** Request start time */
  startTime: number;
}

/**
 * Response context passed to adapters
 */
export interface AdapterResponseContext {
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body (if recorded) */
  body?: unknown;
  /** Request duration in milliseconds */
  duration: number;
}

/**
 * Error context for exception handling
 */
export interface AdapterErrorContext {
  /** The error that occurred */
  error: Error;
  /** Associated request ID */
  requestId?: string;
  /** Whether the error was handled */
  handled: boolean;
}

/**
 * Span processor strategy for telemetry export
 */
export type SpanProcessorStrategy = 'batch' | 'simple';

/**
 * Options for span processor configuration
 */
export interface SpanProcessorOptions {
  /** Processor strategy (batch for servers, simple for Lambda) */
  strategy: SpanProcessorStrategy;
  /** Maximum queue size for batch processor (default: 2048) */
  maxQueueSize?: number;
  /** Scheduled delay for batch processor in ms (default: 5000) */
  scheduledDelayMillis?: number;
  /** Export timeout in ms (default: 30000) */
  exportTimeoutMillis?: number;
  /** Maximum export batch size (default: 512) */
  maxExportBatchSize?: number;
}

/**
 * Adapter lifecycle hooks
 */
export interface AdapterLifecycle {
  /**
   * Called when the adapter is initialized
   */
  onSetup?(): Promise<void> | void;

  /**
   * Called before the adapter is destroyed
   */
  onDestroy?(): Promise<void> | void;
}

/**
 * Base adapter configuration
 */
export interface AdapterConfig {
  /** Environment type */
  environment: TelescopeEnvironment;
  /** Span processor options */
  spanProcessor?: SpanProcessorOptions;
  /** Whether to auto-flush on response */
  autoFlush?: boolean;
}

/**
 * Interface for environment-specific adapters.
 * Adapters handle the integration between Telescope core and the runtime environment.
 */
export interface TelescopeAdapter<TConfig extends AdapterConfig = AdapterConfig>
  extends AdapterLifecycle {
  /** Adapter configuration */
  readonly config: TConfig;

  /**
   * Extract request context from the runtime's request object.
   * This is called at the start of request processing.
   */
  extractRequestContext(request: unknown): AdapterRequestContext;

  /**
   * Extract response context from the runtime's response object.
   * This is called after the response is generated.
   */
  extractResponseContext(
    response: unknown,
    startTime: number,
  ): AdapterResponseContext;

  /**
   * Flush any pending telemetry data.
   * Critical for serverless environments where the process may be frozen.
   */
  flush(): Promise<void>;
}

/**
 * Hono-specific adapter configuration
 */
export interface HonoAdapterConfig extends AdapterConfig {
  environment: 'server' | 'lambda' | 'edge';
}

/**
 * Lambda-specific adapter configuration
 */
export interface LambdaAdapterConfig extends AdapterConfig {
  environment: 'lambda';
  /** Whether to detect Lambda resource attributes */
  detectResource?: boolean;
  /** Custom resource attributes */
  resourceAttributes?: Record<string, string>;
}

/**
 * Type helper for Hono context with Telescope
 */
export interface TelescopeHonoContext {
  /** Request ID for correlation */
  requestId: string;
  /** Request start time */
  startTime: number;
}

/**
 * Hono context variables type
 */
export interface TelescopeHonoVariables {
  telescope: TelescopeHonoContext;
}

/**
 * Extended Hono context with Telescope variables
 */
export type HonoContextWithTelescope = HonoContext<{
  Variables: TelescopeHonoVariables;
}>;
