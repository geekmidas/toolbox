import type { Logger } from '@geekmidas/logger';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { CookieFn, HeaderFn } from './Endpoint';

/**
 * RLS context - key-value pairs to set as PostgreSQL session variables.
 * Keys become `prefix.key` (e.g., `app.user_id`).
 */
export interface RlsContext {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Function type for extracting RLS context from request context.
 *
 * @template TServices - Available service dependencies
 * @template TSession - Session data type
 * @template TLogger - Logger type
 *
 * @example
 * ```ts
 * const extractor: RlsContextExtractor<[], UserSession> = ({ session }) => ({
 *   user_id: session.userId,
 *   tenant_id: session.tenantId,
 *   roles: session.roles.join(','),
 * });
 * ```
 */
export type RlsContextExtractor<
  TServices extends Service[] = [],
  TSession = unknown,
  TLogger extends Logger = Logger,
> = (ctx: {
  services: ServiceRecord<TServices>;
  session: TSession;
  header: HeaderFn;
  cookie: CookieFn;
  logger: TLogger;
}) => RlsContext | Promise<RlsContext>;

/**
 * Configuration for RLS on an endpoint or factory.
 *
 * @template TServices - Available service dependencies
 * @template TSession - Session data type
 * @template TLogger - Logger type
 */
export interface RlsConfig<
  TServices extends Service[] = [],
  TSession = unknown,
  TLogger extends Logger = Logger,
> {
  /** Function to extract RLS context from request */
  extractor: RlsContextExtractor<TServices, TSession, TLogger>;
  /** Prefix for PostgreSQL session variables (default: 'app') */
  prefix?: string;
}

/**
 * Symbol used to bypass RLS for an endpoint.
 */
export const RLS_BYPASS = Symbol.for('geekmidas.rls.bypass');

/**
 * Type for RLS bypass marker.
 */
export type RlsBypass = typeof RLS_BYPASS;
