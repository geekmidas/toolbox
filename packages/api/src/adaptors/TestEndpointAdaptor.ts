import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
  Endpoint,
  EndpointContext,
  EndpointSchemas,
} from '../constructs/Endpoint';
import type { HttpMethod, InferStandardSchema } from '../constructs/types';
import type { ConsoleLogger, Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';

export class HonoEndpointAdaptor<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
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
    ctx: Omit<EndpointContext<TInput, TServices, TLogger, TSession>, 'session'>,
  ): Promise<InferStandardSchema<TOutSchema>> {
    const body = await this.endpoint.parseInput(ctx.body, 'body');
    const query = await this.endpoint.parseInput(ctx.query, 'query');
    const params = await this.endpoint.parseInput(ctx.params, 'params');
    const session = await this.endpoint.getSession({
      logger: ctx.logger,
      services: ctx.services,
    });
    // @ts-ignore
    return this.endpoint.handler({
      body,
      query,
      params,
      session,
      services: ctx.services,
      logger: ctx.logger as TLogger,
      header: ctx.header,
    }) as Promise<InferStandardSchema<TOutSchema>>;
  }
}
