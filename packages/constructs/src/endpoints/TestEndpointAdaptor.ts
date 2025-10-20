import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type {
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/schema';
import {
  type Service,
  ServiceDiscovery,
  type ServiceRecord,
} from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { publishConstructEvents } from '../publisher';
import type { HttpMethod } from '../types';
import {
  Endpoint,
  type EndpointSchemas,
  ResponseBuilder,
  type ResponseWithMetadata,
} from './Endpoint';

export class TestEndpointAdaptor<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> {
  static getDefaultServiceDiscover<
    TRoute extends string,
    TMethod extends HttpMethod,
    TInput extends EndpointSchemas = {},
    TOutSchema extends StandardSchemaV1 | undefined = undefined,
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
    TSession = unknown,
    TEventPublisher extends EventPublisher<any> | undefined = undefined,
    TEventPublisherServiceName extends string = string,
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
      TEventPublisherServiceName
    >,
  ) {
    return ServiceDiscovery.getInstance(
      endpoint.logger,
      new EnvironmentParser({}),
    );
  }
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
      TEventPublisherServiceName
    >,
    private serviceDiscovery: ServiceDiscovery<
      any,
      any
    > = TestEndpointAdaptor.getDefaultServiceDiscover(endpoint),
  ) {}

  async request(
    ctx: TestRequestAdaptor<
      TInput,
      TServices,
      TEventPublisher,
      TEventPublisherServiceName
    >,
  ): Promise<
    | InferStandardSchema<TOutSchema>
    | ResponseWithMetadata<InferStandardSchema<TOutSchema>>
  > {
    const body = await this.endpoint.parseInput((ctx as any).body, 'body');
    const query = await this.endpoint.parseInput((ctx as any).query, 'query');
    const params = await this.endpoint.parseInput(
      (ctx as any).params,
      'params',
    );

    const header = Endpoint.createHeaders(ctx.headers);
    const cookie = Endpoint.createCookies(ctx.headers.cookie);
    const logger = this.endpoint.logger.child({
      route: this.endpoint.route,
      host: ctx.headers.host,
      method: this.endpoint.method,
    }) as TLogger;
    const session = await this.endpoint.getSession({
      logger,
      services: ctx.services,
      header,
      cookie,
    });

    const responseBuilder = new ResponseBuilder();
    const response = await this.endpoint.handler(
      {
        body,
        query,
        params,
        session,
        services: ctx.services,
        logger,
        header,
        cookie,
      } as any,
      responseBuilder,
    );

    // Check if response has metadata
    let data = response;
    let metadata = responseBuilder.getMetadata();

    if (Endpoint.hasMetadata(response)) {
      data = response.data;
      metadata = response.metadata;
    }

    const output = await this.endpoint.parseOutput(data);
    ctx.publisher && (await this.serviceDiscovery.register([ctx.publisher]));

    await publishConstructEvents(this.endpoint, output, this.serviceDiscovery);

    // Return with metadata if any was set
    if (
      (metadata.headers && Object.keys(metadata.headers).length > 0) ||
      (metadata.cookies && metadata.cookies.size > 0) ||
      metadata.status
    ) {
      return { data: output, metadata };
    }

    return output;
  }
}

export type TestRequestAdaptor<
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> = {
  services: ServiceRecord<TServices>;
  headers: Record<string, string>;
  publisher?: Service<TEventPublisherServiceName, TEventPublisher>;
} & InferComposableStandardSchema<TInput>;
