import type { EnvironmentParser } from '@geekmidas/envkit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type Context, Hono } from 'hono';
import { validator } from 'hono/validator';
import {
  Endpoint,
  type EndpointContext,
  type EndpointSchemas,
} from '../constructs/Endpoint';
import type { HttpMethod, LowerHttpMethod } from '../constructs/types';
import { getEndpointsFromRoutes } from '../helpers';
import type { Logger } from '../logger';
import { checkRateLimit, getRateLimitHeaders } from '../rate-limit';
import { parseHonoQuery } from './utils/parseHonoQuery';

import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { wrapError } from '../errors';
import {
  type Service,
  ServiceDiscovery,
  type ServiceRecord,
} from '../services';

export class HonoEndpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> {
  constructor(
    private readonly endpoint: Endpoint<
      TRoute,
      TMethod,
      TInput,
      TOutSchema,
      TServices,
      TLogger,
      TSession
    >,
  ) {}

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

  static async fromRoutes<TLogger extends Logger, TServices extends Service[]>(
    routes: string[],
    envParser: EnvironmentParser<{}>,
    app = new Hono(),
    logger: TLogger,
    cwd = process.cwd(),
  ): Promise<Hono> {
    const endpoints = await getEndpointsFromRoutes<TServices>(routes, cwd);
    const serviceDiscovery = ServiceDiscovery.getInstance<
      ServiceRecord<TServices>,
      TLogger
    >(logger, envParser);

    HonoEndpoint.addRoutes(endpoints, serviceDiscovery, app);

    return app;
  }

  static addRoutes<
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
  >(
    endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
    serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
    app: Hono,
  ): void {
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
  >(
    endpoint: Endpoint<
      TRoute,
      TMethod,
      TInput,
      TOutSchema,
      TServices,
      TLogger,
      TSession
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
          logger.debug('Processing endpoint request');

          const headerValues = c.req.header();

          const header = Endpoint.createHeaders(headerValues);

          const services = await serviceDiscovery.register(endpoint.services);

          const session = await endpoint.getSession({
            services,
            logger,
            header,
          });

          const isAuthorized = await endpoint.authorize({
            header,
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

          const response = await endpoint.handler({
            services,
            logger,
            body: c.req.valid('json'),
            query: c.req.valid('query'),
            params: c.req.valid('param'),
            session,
            header: Endpoint.createHeaders(headerValues),
          } as unknown as EndpointContext<
            TInput,
            TServices,
            TLogger,
            TSession
          >);

          return c.json(response);
        } catch (e) {
          console.error('Error processing endpoint request', e);
          logger.error(e, 'Error processing endpoint request');
          const error = wrapError(e, 500, 'Internal Server Error');
          return c.json(error, error.statusCode as ContentfulStatusCode);
        }
      },
    );
  }
}
