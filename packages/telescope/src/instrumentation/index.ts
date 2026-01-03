/**
 * OpenTelemetry Instrumentation for @geekmidas/constructs
 *
 * This module provides automatic instrumentation for constructs endpoints,
 * functions, crons, and subscribers using the OpenTelemetry SDK.
 *
 * @example
 * ```typescript
 * import { setupTelemetry } from '@geekmidas/telescope/instrumentation';
 *
 * // Call before importing your app code
 * setupTelemetry({
 *   serviceName: 'my-api',
 *   // Dev: send to Telescope
 *   endpoint: 'http://localhost:3000/__telescope/v1',
 *   // Enable Pino log correlation
 *   instrumentPino: true,
 * });
 * ```
 */

export { setupTelemetry } from './setup';
export type { TelemetryOptions } from './setup';
export {
  createSpan,
  withSpan,
  getActiveSpan,
  setSpanAttributes,
} from './tracing';
