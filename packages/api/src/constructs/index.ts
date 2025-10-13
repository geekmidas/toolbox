/**
 * BACKWARD COMPATIBILITY RE-EXPORTS
 *
 * These exports maintain backward compatibility with code that imports
 * from '@geekmidas/api/constructs'.
 *
 * @deprecated Import from '@geekmidas/constructs' instead.
 * These re-exports will be removed in v3.0.0.
 */

// Re-export core constructs
export type {
  Endpoint,
  EndpointContext,
  EndpointHandler,
  EndpointSchemas,
  EndpointOptions,
  SessionFn,
  AuthorizeFn,
} from '@geekmidas/constructs/endpoint';

export { SuccessStatus } from '@geekmidas/constructs/endpoint';

export type {
  Function,
  FunctionContext,
  FunctionHandler,
} from '@geekmidas/constructs/function';

export type { Cron } from '@geekmidas/constructs/cron';

export type { Subscriber } from '@geekmidas/constructs/subscriber';

export { Construct, ConstructType } from '@geekmidas/constructs';

// Re-export builders
export { EndpointBuilder, EndpointFactory } from '@geekmidas/constructs/builders';

// Re-export errors
export { UnprocessableEntityError } from '@geekmidas/constructs';

// Re-export types
export type {
  HttpMethod,
  ComposableStandardSchema,
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/constructs/types';

// Re-export schema utilities (now from @geekmidas/schema)
export {
  convertStandardSchemaToJsonSchema,
  convertSchemaWithComponents,
} from '@geekmidas/schema/conversion';

export {
  buildOpenApiSchema,
  createComponentCollector,
} from '@geekmidas/schema/openapi';

export type {
  ComponentCollector,
  OpenApiSchemaOptions,
} from '@geekmidas/schema/openapi';
