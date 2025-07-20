import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Endpoint, type EndpointSchemas } from '../constructs/Endpoint';
import type {
  HttpMethod,
  InferComposableStandardSchema,
  InferStandardSchema,
} from '../constructs/types';
import type { Logger } from '../logger';
import type { Service, ServiceRecord } from '../services';

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
    ctx: TestRequestAdaptor<TInput, TServices>,
  ): Promise<InferStandardSchema<TOutSchema>> {
    const body = await this.endpoint.parseInput((ctx as any).body, 'body');
    const query = await this.endpoint.parseInput((ctx as any).query, 'query');
    const params = await this.endpoint.parseInput(
      (ctx as any).params,
      'params',
    );

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

    const response = await this.endpoint.handler({
      body,
      query,
      params,
      session,
      services: ctx.services,
      logger,
      header,
    } as any);

    return this.endpoint.parseOutput(response);
  }
}

export type TestRequestAdaptor<
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
> = {
  services: ServiceRecord<TServices>;
  headers: Record<string, string>;
} & InferComposableStandardSchema<TInput>;
