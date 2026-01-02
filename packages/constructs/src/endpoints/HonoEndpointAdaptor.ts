import type { AuditStorage, AuditableAction } from '@geekmidas/audit';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { checkRateLimit, getRateLimitHeaders } from '@geekmidas/rate-limit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type Context, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { logger as honoLogger } from 'hono/logger';
import { timing } from 'hono/timing';
import { validator } from 'hono/validator';
import type { HttpMethod, LowerHttpMethod } from '../types';
import {
  Endpoint,
  type EndpointContext,
  type EndpointSchemas,
  ResponseBuilder,
} from './Endpoint';
import { getEndpointsFromRoutes } from './helpers';
import { parseHonoQuery } from './parseHonoQuery';

import { withRlsContext } from '@geekmidas/db/rls';
import { wrapError } from '@geekmidas/errors';
import {
  type Service,
  ServiceDiscovery,
  type ServiceRecord,
} from '@geekmidas/services';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { publishConstructEvents } from '../publisher';
import type { MappedAudit } from './audit';
import {
  createAuditContext,
  executeWithAuditTransaction,
} from './processAudits';

export interface HonoEndpointOptions {
  /**
   * Path where OpenAPI documentation will be served.
   * Set to false to disable docs route.
   * @default '/docs'
   */
  docsPath?: string | false;
  /**
   * OpenAPI schema options
   */
  openApiOptions?: {
    title?: string;
    version?: string;
    description?: string;
  };
}

export class HonoEndpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> {
  constructor(
    private readonly endpoint: Endpoint<
      TRoute,
      TMethod,
      TInput,
      TOutSchema,
      TServices,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >,
  ) {}

  static isDev = process.env.NODE_ENV === 'development';

  static async validate<T extends StandardSchemaV1>(
    c: Context<any, string, {}>,
    data: unknown,
    schema?: T,
  ) {
    if (!schema) {
      return undefined;
    }

    const parsed = await Endpoint.validate(schema, data);

    if (parsed.issues) {
      return c.json(parsed.issues, 422);
    }

    return parsed.value;
  }
  addRoute(
    serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
    app: Hono,
  ): void {
    HonoEndpoint.addRoute(this.endpoint, serviceDiscovery, app);
  }

  static applyEventMiddleware(
    app: Hono,
    serviceDiscovery: ServiceDiscovery<any, any>,
  ) {
    app.use(async (c, next) => {
      await next();
      // @ts-ignore
      const endpoint = c.get('__endpoint') as Endpoint<
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any
      >;
      // @ts-ignore
      const response = c.get('__response');
      // @ts-ignore
      const logger = c.get('__logger') as Logger;

      if (Endpoint.isSuccessStatus(c.res.status) && endpoint) {
        // Process events (audits are handled in the handler with transaction support)
        await publishConstructEvents<any, any>(
          endpoint,
          response,
          serviceDiscovery,
          logger,
        );
      }
    });
  }

  static async fromRoutes<TLogger extends Logger, TServices extends Service[]>(
    routes: string[],
    envParser: EnvironmentParser<{}>,
    app = new Hono(),
    logger: TLogger,
    cwd = process.cwd(),
    options?: HonoEndpointOptions,
  ): Promise<Hono> {
    const endpoints = await getEndpointsFromRoutes<TServices>(routes, cwd);
    const serviceDiscovery = ServiceDiscovery.getInstance<
      ServiceRecord<TServices>,
      TLogger
    >(logger, envParser);

    HonoEndpoint.addRoutes(endpoints, serviceDiscovery, app, options);

    return app;
  }

  static addRoutes<
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
  >(
    endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
    serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
    app: Hono,
    options?: HonoEndpointOptions,
  ): void {
    // Add timing middleware (always enabled)
    app.use('*', timing());

    // Add logger middleware in development mode

    if (HonoEndpoint.isDev) {
      app.use('*', honoLogger());
    }

    // Add docs route if not disabled
    const docsPath =
      options?.docsPath !== false ? options?.docsPath || '/docs' : null;
    if (docsPath) {
      HonoEndpoint.addDocsRoute(
        endpoints,
        app,
        docsPath,
        options?.openApiOptions,
      );
    }

    // Sort endpoints to ensure static routes come before dynamic ones
    const sortedEndpoints = endpoints.sort((a, b) => {
      const aSegments = a.route.split('/');
      const bSegments = b.route.split('/');

      // Compare each segment
      for (let i = 0; i < Math.max(aSegments.length, bSegments.length); i++) {
        const aSegment = aSegments[i] || '';
        const bSegment = bSegments[i] || '';

        // If one is dynamic and the other is not, static comes first
        const aIsDynamic = aSegment.startsWith(':');
        const bIsDynamic = bSegment.startsWith(':');

        if (!aIsDynamic && bIsDynamic) return -1;
        if (aIsDynamic && !bIsDynamic) return 1;

        // If both are the same type, compare alphabetically
        if (aSegment !== bSegment) {
          return aSegment.localeCompare(bSegment);
        }
      }

      return 0;
    });
    HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
    for (const endpoint of sortedEndpoints) {
      HonoEndpoint.addRoute(endpoint, serviceDiscovery, app);
    }
  }

  static addRoute<
    TRoute extends string,
    TMethod extends HttpMethod,
    TInput extends EndpointSchemas = {},
    TOutSchema extends StandardSchemaV1 | undefined = undefined,
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
    TSession = unknown,
    TEventPublisher extends EventPublisher<any> | undefined = undefined,
    TEventPublisherServiceName extends string = string,
    TAuditStorage extends AuditStorage | undefined = undefined,
    TAuditStorageServiceName extends string = string,
    TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
      string,
      unknown
    >,
    TDatabase = undefined,
    TDatabaseServiceName extends string = string,
  >(
    endpoint: Endpoint<
      TRoute,
      TMethod,
      TInput,
      TOutSchema,
      TServices,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >,
    serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
    app: Hono,
  ): void {
    const { route } = endpoint;
    const method = endpoint.method.toLowerCase() as LowerHttpMethod<TMethod>;

    app[method](
      route,
      validator('json', (value, c) =>
        HonoEndpoint.validate(c, value, endpoint.input?.body),
      ),
      validator('query', (_, c) => {
        const parsedQuery = parseHonoQuery(c);
        return HonoEndpoint.validate(c, parsedQuery, endpoint.input?.query);
      }),
      validator('param', (params, c) =>
        HonoEndpoint.validate(c, params, endpoint.input?.params),
      ),
      async (c) => {
        const logger = endpoint.logger.child({
          endpoint: endpoint.fullPath,
          route: endpoint.route,
          host: c.header('host'),
          method: endpoint.method,
          path: c.req.path,
        }) as TLogger;

        try {
          const headerValues = c.req.header();

          const header = Endpoint.createHeaders(headerValues);
          const cookie = Endpoint.createCookies(headerValues.cookie);

          const services = await serviceDiscovery.register(endpoint.services);

          // Resolve database service early so it's available for session extraction
          const rawDb = endpoint.databaseService
            ? await serviceDiscovery
                .register([endpoint.databaseService])
                .then(
                  (s) =>
                    s[endpoint.databaseService!.serviceName as keyof typeof s],
                )
            : undefined;

          const session = await endpoint.getSession({
            services,
            logger,
            header,
            cookie,
            ...(rawDb !== undefined && { db: rawDb }),
          } as any);

          const isAuthorized = await endpoint.authorize({
            header,
            cookie,
            services,
            logger,
            session,
          });

          if (!isAuthorized) {
            logger.warn('Unauthorized access attempt');
            return c.json({ error: 'Unauthorized' }, 401);
          }

          // Check rate limit if configured
          if (endpoint.rateLimit) {
            const rateLimitInfo = await checkRateLimit(endpoint.rateLimit, {
              header,
              services,
              logger,
              session,
              path: c.req.path,
              method: endpoint.method,
            });

            // Set rate limit headers
            const rateLimitHeaders = getRateLimitHeaders(
              rateLimitInfo,
              endpoint.rateLimit,
            );
            for (const [key, value] of Object.entries(rateLimitHeaders)) {
              if (value) {
                c.header(key, value);
              }
            }
          }

          // Create audit context if audit storage is configured
          const auditContext = await createAuditContext(
            endpoint,
            serviceDiscovery,
            logger,
            {
              session,
              header,
              cookie,
              services: services as Record<string, unknown>,
            },
          );

          // Warn if declarative audits are configured but no audit storage
          const audits = endpoint.audits as MappedAudit<
            TAuditAction,
            TOutSchema
          >[];
          if (!auditContext && audits?.length) {
            logger.warn('No auditor storage service available');
          }

          // Extract RLS context if configured and not bypassed
          const rlsActive =
            endpoint.rlsConfig && !endpoint.rlsBypass && rawDb !== undefined;
          const rlsContext = rlsActive
            ? await endpoint.rlsConfig!.extractor({
                services,
                session,
                header,
                cookie,
                logger,
              })
            : undefined;

          // Execute handler with automatic audit transaction support
          const result = await executeWithAuditTransaction(
            auditContext,
            async (auditor) => {
              // Use audit transaction as db only if the storage uses the same database service
              const sameDatabase =
                auditContext?.storage?.databaseServiceName &&
                auditContext.storage.databaseServiceName ===
                  endpoint.databaseService?.serviceName;
              const baseDb = sameDatabase
                ? (auditor?.getTransaction?.() ?? rawDb)
                : rawDb;

              // Helper to execute handler with given db
              const executeHandler = async (db: TDatabase | undefined) => {
                const responseBuilder = new ResponseBuilder();
                const response = await endpoint.handler(
                  {
                    services,
                    logger,
                    body: c.req.valid('json'),
                    query: c.req.valid('query'),
                    params: c.req.valid('param'),
                    session,
                    header,
                    cookie,
                    auditor,
                    db,
                  } as unknown as EndpointContext<
                    TInput,
                    TServices,
                    TLogger,
                    TSession,
                    TAuditAction,
                    TDatabase,
                    TAuditStorage
                  >,
                  responseBuilder,
                );

                // Check if response has metadata
                let data = response;
                let metadata = responseBuilder.getMetadata();

                if (Endpoint.hasMetadata(response)) {
                  data = response.data;
                  metadata = response.metadata;
                }

                const output = endpoint.outputSchema
                  ? await endpoint.parseOutput(data)
                  : undefined;

                return { output, metadata, responseBuilder };
              };

              // If RLS is active, wrap handler with RLS context
              if (rlsActive && rlsContext && baseDb) {
                return withRlsContext(
                  baseDb as any,
                  rlsContext,
                  async (trx) => executeHandler(trx as TDatabase),
                  { prefix: endpoint.rlsConfig!.prefix },
                );
              }

              return executeHandler(baseDb as TDatabase | undefined);
            },
            // Process declarative audits after handler (inside transaction)
            async (result, auditor) => {
              if (!audits?.length) return;

              for (const audit of audits) {
                if (audit.when && !audit.when(result.output as any)) {
                  continue;
                }
                const payload = audit.payload(result.output as any);
                const entityId = audit.entityId?.(result.output as any);
                auditor.audit(audit.type as any, payload as any, {
                  table: audit.table,
                  entityId,
                });
              }
            },
            // Pass rawDb so storage can reuse existing transactions
            { db: rawDb },
          );

          const { output, metadata } = result;

          try {
            let status = endpoint.status as ContentfulStatusCode;

            // Apply response metadata
            if (metadata.status) {
              status = metadata.status as ContentfulStatusCode;
            }

            if (metadata.headers) {
              for (const [key, value] of Object.entries(metadata.headers)) {
                c.header(key, value);
              }
            }

            if (metadata.cookies) {
              for (const [name, { value, options }] of metadata.cookies) {
                setCookie(c, name, value, options);
              }
            }

            // @ts-ignore
            c.set('__response', output);
            // @ts-ignore
            c.set('__endpoint', endpoint);
            // @ts-ignore
            c.set('__logger', logger);
            // @ts-ignore
            c.set('__session', session);
            // @ts-ignore
            c.set('__services', services);

            if (HonoEndpoint.isDev) {
              logger.info({ status, body: output }, 'Outgoing response');
            }
            // @ts-ignore
            return c.json(output, status);
          } catch (validationError: any) {
            logger.error(validationError, 'Output validation failed');
            const error = wrapError(
              validationError,
              422,
              'Response validation failed',
            );
            if (HonoEndpoint.isDev) {
              logger.info(
                { status: error.statusCode, body: error },
                'Outgoing response',
              );
            }
            return c.json(error, error.statusCode as ContentfulStatusCode);
          }
        } catch (e: any) {
          logger.error(e, 'Error processing endpoint request');
          const error = wrapError(e, 500, 'Internal Server Error');
          if (HonoEndpoint.isDev) {
            logger.info(
              { status: error.statusCode, body: error },
              'Outgoing response',
            );
          }
          return c.json(error, error.statusCode as ContentfulStatusCode);
        }
      },
    );
  }

  static addDocsRoute<
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
  >(
    endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
    app: Hono,
    docsPath: string,
    openApiOptions?: HonoEndpointOptions['openApiOptions'],
  ): void {
    app.get(docsPath, async (c) => {
      try {
        const openApiSchema = await Endpoint.buildOpenApiSchema(
          endpoints,
          openApiOptions,
        );

        return c.json(openApiSchema);
      } catch {
        return c.json(
          { error: 'Failed to generate OpenAPI documentation' },
          500,
        );
      }
    });
  }
}
