import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Endpoint, type EndpointSchemas } from '../constructs/Endpoint';
import type { HttpMethod, InferStandardSchema } from '../constructs/types';
import type { Logger } from '../logger';
import type { Service, ServiceDiscovery, ServiceRecord } from '../services';

export class TestEndpointAdaptor<
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

  async request(
    ctx: TestRequestAdaptor<TInput, TServices, TLogger>,
  ): Promise<InferStandardSchema<TOutSchema>> {
    const body = await this.endpoint.parseInput(ctx.body, 'body');
    const query = await this.endpoint.parseInput(ctx.query, 'query');
    const params = await this.endpoint.parseInput(ctx.params, 'params');
    const header = Endpoint.createHeaders(ctx.headers);
    const logger = this.endpoint.logger.child({
      route: this.endpoint.route,
      host: ctx.headers.host,
      method: this.endpoint.method,
    }) as TLogger;
    const session = await this.endpoint.getSession({
      logger,
      services: ctx.services,
      header,
    });
    // @ts-ignore
    const response = await this.endpoint.handler({
      body,
      query,
      params,
      session,
      services: ctx.services,
      logger,
      header,
    });

    return this.endpoint.parseOutput(response);
  }
}

export type TestRequestAdaptor<
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
> = {
  body: InferStandardSchema<TInput['body']>;
  query: InferStandardSchema<TInput['query']>;
  params: InferStandardSchema<TInput['params']>;
  services: ServiceDiscovery<ServiceRecord<TServices>, TLogger>;
  headers: Record<string, string>;
};
