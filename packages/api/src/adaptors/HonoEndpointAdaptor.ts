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
import type { ConsoleLogger, Logger } from '../logger';
import {
  type HermodServiceConstructor,
  HermodServiceDiscovery,
  type HermodServiceRecord,
} from '../services';

export class HonoEndpointAdaptor<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
> {
  constructor(
    private readonly endpoint: Endpoint<
      TRoute,
      TMethod,
      TInput,
      TOutSchema,
      TServices,
      TLogger
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
    serviceDiscovery: HermodServiceDiscovery<
      HermodServiceRecord<TServices>,
      TLogger
    >,
    app: Hono,
  ): void {
    HonoEndpointAdaptor.addRoute(this.endpoint, serviceDiscovery, app);
  }

  static async fromRoutes<
    TLogger extends Logger,
    TServices extends HermodServiceConstructor[],
  >(
    routes: string[],
    envParser: EnvironmentParser<{}>,
    app = new Hono(),
    logger: TLogger,
    cwd = process.cwd(),
  ): Promise<Hono> {
    const endpoints = await getEndpointsFromRoutes(routes, cwd);
    const serviceDiscovery = HermodServiceDiscovery.getInstance<
      HermodServiceRecord<TServices>,
      TLogger
    >(logger, envParser);

    HonoEndpointAdaptor.addRoutes(endpoints, serviceDiscovery, app);

    return app;
  }

  static addRoutes<
    TServices extends HermodServiceConstructor[] = [],
    TLogger extends Logger = ConsoleLogger,
  >(
    endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
    serviceDiscovery: HermodServiceDiscovery<
      HermodServiceRecord<TServices>,
      TLogger
    >,
    app: Hono,
  ): void {
    for (const endpoint of endpoints) {
      HonoEndpointAdaptor.addRoute(endpoint, serviceDiscovery, app);
    }
  }

  static addRoute<
    TRoute extends string,
    TMethod extends HttpMethod,
    TInput extends EndpointSchemas = {},
    TOutSchema extends StandardSchemaV1 | undefined = undefined,
    TServices extends HermodServiceConstructor[] = [],
    TLogger extends Logger = ConsoleLogger,
  >(
    endpoint: Endpoint<TRoute, TMethod, TInput, TOutSchema, TServices, TLogger>,
    serviceDiscovery: HermodServiceDiscovery<
      HermodServiceRecord<TServices>,
      TLogger
    >,
    app: Hono,
  ): void {
    const { route } = endpoint;
    const method = endpoint.method.toLowerCase() as LowerHttpMethod<TMethod>;

    app[method](
      route,
      validator('json', (value, c) =>
        HonoEndpointAdaptor.validate(c, value, endpoint.input?.body),
      ),
      validator('query', (query, c) =>
        HonoEndpointAdaptor.validate(c, query, endpoint.input?.query),
      ),
      validator('param', (params, c) =>
        HonoEndpointAdaptor.validate(c, params, endpoint.input?.params),
      ),
      async (c) => {
        const headerValues = c.req.header();
        const services = await serviceDiscovery.register(endpoint.services);
        const logger = endpoint.logger.child({
          route: endpoint.route,
          host: c.header('host'),
          method: endpoint.method,
          path: c.req.path,
        }) as TLogger;

        const response = await endpoint.handler({
          services,
          logger,
          body: c.req.valid('json'),
          query: c.req.valid('query'),
          params: c.req.valid('param'),
          header: Endpoint.createHeaders(headerValues),
        } as unknown as EndpointContext<TInput, TServices, TLogger>);

        return c.json(response);
      },
    );
  }
}
