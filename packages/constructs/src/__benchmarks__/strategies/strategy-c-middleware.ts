/**
 * Strategy C: Middleware Composition Pattern
 *
 * Key optimizations:
 * 1. Break monolithic handler into composable middleware
 * 2. Only add middleware for features the endpoint uses
 * 3. Early exit on failures (auth, validation, etc.)
 * 4. Typed context instead of magic strings
 */
import type { Logger } from '@geekmidas/logger';
import type {
  Service,
  ServiceDiscovery,
  ServiceRecord,
} from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Hono, Next } from 'hono';
import { validator } from 'hono/validator';
import {
  Endpoint,
  type EndpointSchemas,
  ResponseBuilder,
} from '../../endpoints/Endpoint';
import { parseHonoQuery } from '../../endpoints/parseHonoQuery';
import type { HttpMethod, LowerHttpMethod } from '../../types';

// ============================================================================
// Typed Context
// ============================================================================

interface EndpointContext {
  services: Record<string, any>;
  session: unknown;
  logger: Logger;
  db?: any;
  header: ReturnType<typeof Endpoint.createHeaders>;
  cookie: ReturnType<typeof Endpoint.createCookies>;
}

declare module 'hono' {
  interface ContextVariableMap {
    ctx: EndpointContext;
  }
}

// ============================================================================
// Middleware Factories
// ============================================================================

/**
 * Creates middleware that initializes the endpoint context
 */
function createContextMiddleware<
  TServices extends Service[],
  TLogger extends Logger,
>(
  endpoint: Endpoint<
    any,
    any,
    any,
    any,
    TServices,
    TLogger,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
  serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
): (c: Context, next: Next) => Promise<Response | void> {
  // Pre-resolve service registration promise at setup time
  const servicesPromise =
    endpoint.services.length > 0
      ? serviceDiscovery.register(endpoint.services)
      : Promise.resolve({} as ServiceRecord<TServices>);

  // Pre-resolve database service if configured
  const dbPromise = endpoint.databaseService
    ? serviceDiscovery
        .register([endpoint.databaseService])
        .then((s) => s[endpoint.databaseService!.serviceName as keyof typeof s])
    : Promise.resolve(undefined);

  return async (c, next) => {
    const [services, db] = await Promise.all([servicesPromise, dbPromise]);

    const headerValues = c.req.header();

    const ctx: EndpointContext = {
      services: services as Record<string, any>,
      session: null,
      logger: endpoint.logger,
      db,
      header: Endpoint.createHeaders(headerValues),
      cookie: Endpoint.createCookies(headerValues.cookie),
    };

    c.set('ctx', ctx);
    await next();
  };
}

/**
 * Creates auth middleware (only if endpoint has authorization)
 */
function createAuthMiddleware<
  TServices extends Service[],
  TLogger extends Logger,
>(
  endpoint: Endpoint<
    any,
    any,
    any,
    any,
    TServices,
    TLogger,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
): ((c: Context, next: Next) => Promise<Response | void>) | null {
  if (endpoint.authorizer === 'none') {
    return null;
  }

  return async (c, next) => {
    const ctx = c.get('ctx');

    const session = await endpoint.getSession({
      services: ctx.services,
      logger: ctx.logger,
      header: ctx.header,
      cookie: ctx.cookie,
      ...(ctx.db !== undefined && { db: ctx.db }),
    } as any);

    const isAuthorized = await endpoint.authorize({
      header: ctx.header,
      cookie: ctx.cookie,
      services: ctx.services,
      logger: ctx.logger,
      session,
    });

    if (!isAuthorized) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Update context with session
    ctx.session = session;
    await next();
  };
}

/**
 * Creates the core handler middleware
 */
function createHandlerMiddleware<
  TServices extends Service[],
  TLogger extends Logger,
>(
  endpoint: Endpoint<
    any,
    any,
    any,
    any,
    TServices,
    TLogger,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
): (c: Context) => Promise<Response> {
  return async (c) => {
    const ctx = c.get('ctx');

    try {
      const responseBuilder = new ResponseBuilder();
      const response = await endpoint.handler(
        {
          services: ctx.services,
          logger: ctx.logger,
          body: c.req.valid('json'),
          query: c.req.valid('query'),
          params: c.req.valid('param'),
          session: ctx.session,
          header: ctx.header,
          cookie: ctx.cookie,
          auditor: undefined,
          db: ctx.db,
        } as any,
        responseBuilder,
      );

      // Process response
      let data = response;
      let metadata = responseBuilder.getMetadata();

      if (Endpoint.hasMetadata(response)) {
        data = response.data;
        metadata = response.metadata;
      }

      const output = endpoint.outputSchema
        ? await endpoint.parseOutput(data)
        : data;

      const status = (metadata.status ?? endpoint.status) as any;
      return c.json(output, status);
    } catch (error) {
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  };
}

// ============================================================================
// Validator Factories
// ============================================================================

function createBodyValidator(
  endpoint: Endpoint<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
) {
  return validator('json', async (value, c) => {
    if (!endpoint.input?.body) return undefined;
    const parsed = await Endpoint.validate(endpoint.input.body, value);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });
}

function createQueryValidator(
  endpoint: Endpoint<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
) {
  return validator('query', async (_, c) => {
    if (!endpoint.input?.query) return undefined;
    const parsedQuery = parseHonoQuery(c);
    const parsed = await Endpoint.validate(endpoint.input.query, parsedQuery);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });
}

function createParamValidator(
  endpoint: Endpoint<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
) {
  return validator('param', async (params, c) => {
    if (!endpoint.input?.params) return undefined;
    const parsed = await Endpoint.validate(endpoint.input.params, params);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });
}

// ============================================================================
// Main Adaptor
// ============================================================================

/**
 * Middleware-based HonoEndpoint adaptor
 */
export class MiddlewareHonoEndpoint {
  /**
   * Add routes using middleware composition
   */
  static addRoutes<
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
  >(
    endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
    serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
    app: Hono,
  ): void {
    // Sort endpoints (static routes before dynamic)
    const sortedEndpoints = [...endpoints].sort((a, b) => {
      const aHasDynamic = a.route.includes(':');
      const bHasDynamic = b.route.includes(':');
      if (!aHasDynamic && bHasDynamic) return -1;
      if (aHasDynamic && !bHasDynamic) return 1;
      return a.route.localeCompare(b.route);
    });

    for (const endpoint of sortedEndpoints) {
      this.addRoute(endpoint, serviceDiscovery, app);
    }
  }

  /**
   * Add a single route with composed middleware
   */
  static addRoute<
    TRoute extends string,
    TMethod extends HttpMethod,
    TInput extends EndpointSchemas = {},
    TOutSchema extends StandardSchemaV1 | undefined = undefined,
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
  >(
    endpoint: Endpoint<
      TRoute,
      TMethod,
      TInput,
      TOutSchema,
      TServices,
      TLogger,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >,
    serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
    app: Hono,
  ): void {
    const { route } = endpoint;
    const method = endpoint.method.toLowerCase() as LowerHttpMethod<TMethod>;

    // Build middleware chain
    const middlewares: ((
      c: Context,
      next: Next,
    ) => Promise<Response | void>)[] = [];

    // 1. Context initialization (always needed)
    middlewares.push(createContextMiddleware(endpoint, serviceDiscovery));

    // 2. Auth middleware (only if endpoint has authorization)
    const authMiddleware = createAuthMiddleware(endpoint);
    if (authMiddleware) {
      middlewares.push(authMiddleware);
    }

    // 3. Validators
    const validators = [
      createBodyValidator(endpoint),
      createQueryValidator(endpoint),
      createParamValidator(endpoint),
    ];

    // 4. Core handler
    const handler = createHandlerMiddleware(endpoint);

    // Register route with all middleware
    app[method](route, ...validators, ...middlewares, handler);
  }
}

// ============================================================================
// Minimal Adaptor (No middleware, just handler)
// ============================================================================

/**
 * Ultra-minimal adaptor for comparison
 * No middleware composition, just inline handler
 */
export class MinimalHonoEndpoint {
  static addRoutes<
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
  >(
    endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
    serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
    app: Hono,
  ): void {
    for (const endpoint of endpoints) {
      this.addRoute(endpoint, serviceDiscovery, app);
    }
  }

  static addRoute<
    TRoute extends string,
    TMethod extends HttpMethod,
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
  >(
    endpoint: Endpoint<
      TRoute,
      TMethod,
      any,
      any,
      TServices,
      TLogger,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >,
    serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
    app: Hono,
  ): void {
    const { route } = endpoint;
    const method = endpoint.method.toLowerCase() as LowerHttpMethod<any>;

    // Pre-resolve services at setup time
    const servicesPromise =
      endpoint.services.length > 0
        ? serviceDiscovery.register(endpoint.services)
        : Promise.resolve({});

    // Single inline handler - no middleware
    app[method](route, async (c) => {
      try {
        const services = await servicesPromise;

        // Inline validation
        let body: any;
        if (endpoint.input?.body) {
          const rawBody = await c.req.json().catch(() => ({}));
          const parsed = await Endpoint.validate(endpoint.input.body, rawBody);
          if (parsed.issues) return c.json(parsed.issues, 422);
          body = parsed.value;
        }

        let query: any;
        if (endpoint.input?.query) {
          const parsedQuery = parseHonoQuery(c);
          const parsed = await Endpoint.validate(
            endpoint.input.query,
            parsedQuery,
          );
          if (parsed.issues) return c.json(parsed.issues, 422);
          query = parsed.value;
        }

        let params: any;
        if (endpoint.input?.params) {
          const parsed = await Endpoint.validate(
            endpoint.input.params,
            c.req.param(),
          );
          if (parsed.issues) return c.json(parsed.issues, 422);
          params = parsed.value;
        }

        // Execute handler
        const responseBuilder = new ResponseBuilder();
        const response = await endpoint.handler(
          {
            services,
            logger: endpoint.logger,
            body,
            query,
            params,
            session: undefined,
            header: Endpoint.createHeaders(c.req.header()),
            cookie: Endpoint.createCookies(c.req.header().cookie),
            auditor: undefined,
            db: undefined,
          } as any,
          responseBuilder,
        );

        // Process response
        const output = endpoint.outputSchema
          ? await endpoint.parseOutput(response)
          : response;

        return c.json(output, endpoint.status as any);
      } catch (error) {
        return c.json({ error: 'Internal Server Error' }, 500);
      }
    });
  }
}
