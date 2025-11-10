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
  type CookieOptions,
  Endpoint,
  type EndpointSchemas,
  ResponseBuilder,
} from './Endpoint';

export type TestHttpResponse<TBody = any> = {
  body: TBody;
  status: number;
  headers: Record<string, string | string[]>;
};

/**
 * Serializes a cookie into a Set-Cookie header string
 */
function serializeCookie(
  name: string,
  value: string,
  options?: CookieOptions,
): string {
  let cookieString = `${name}=${value}`;

  if (options) {
    if (options.maxAge !== undefined) {
      cookieString += `; Max-Age=${options.maxAge}`;
    }
    if (options.expires) {
      cookieString += `; Expires=${options.expires.toUTCString()}`;
    }
    if (options.domain) {
      cookieString += `; Domain=${options.domain}`;
    }
    if (options.path) {
      cookieString += `; Path=${options.path}`;
    }
    if (options.httpOnly) {
      cookieString += '; HttpOnly';
    }
    if (options.secure) {
      cookieString += '; Secure';
    }
    if (options.sameSite) {
      cookieString += `; SameSite=${options.sameSite}`;
    }
  }

  return cookieString;
}

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

  async fullRequest(
    ctx: TestRequestAdaptor<
      TInput,
      TServices,
      TEventPublisher,
      TEventPublisherServiceName
    >,
  ): Promise<TestHttpResponse<InferStandardSchema<TOutSchema>>> {
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

    // Convert cookies to Set-Cookie headers
    const headers: Record<string, string | string[]> = {
      ...(metadata.headers || {}),
    };

    if (metadata.cookies && metadata.cookies.size > 0) {
      const setCookieValues: string[] = [];
      for (const [name, cookie] of metadata.cookies.entries()) {
        setCookieValues.push(serializeCookie(name, cookie.value, cookie.options));
      }
      headers['set-cookie'] = setCookieValues;
    }

    // Return HTTP response format
    return {
      body: output,
      status: metadata.status || 200,
      headers,
    };
  }

  async request(
    ctx: TestRequestAdaptor<
      TInput,
      TServices,
      TEventPublisher,
      TEventPublisherServiceName
    >,
  ): Promise<InferStandardSchema<TOutSchema>> {
    const response = await this.fullRequest(ctx);
    return response.body;
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
