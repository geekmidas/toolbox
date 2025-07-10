import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Hono } from 'hono';
import { validator } from 'hono/validator';
import {
  Endpoint,
  type EndpointContext,
  type EndpointSchemas,
} from '../constructs/Endpoint';
import type { HttpMethod, LowerHttpMethod } from '../constructs/types';
import type { ConsoleLogger, Logger } from '../logger';
import type {
  HermodServiceConstructor,
  HermodServiceDiscovery,
  HermodServiceRecord,
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

    const parsed = await Endpoint.parseSchema(schema, data);

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
    app: Hono<{
      Variables: {
        services: HermodServiceRecord<TServices>;
        logger: TLogger;
      };
    }>,
  ): void {
    const { route } = this.endpoint;
    const method =
      this.endpoint.method.toLowerCase() as LowerHttpMethod<TMethod>;

    app[method](
      route,
      validator('json', (value, c) =>
        HonoEndpointAdaptor.validate(c, value, this.endpoint.input?.body),
      ),
      validator('query', (query, c) =>
        HonoEndpointAdaptor.validate(c, query, this.endpoint.input?.query),
      ),
      validator('param', (params, c) =>
        HonoEndpointAdaptor.validate(c, params, this.endpoint.input?.params),
      ),
      async (c) => {
        const headerValues = c.req.header();
        const services = await serviceDiscovery.register(
          this.endpoint.services,
        );

        const response = await this.endpoint.handler({
          services,
          logger: this.endpoint.logger,
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
