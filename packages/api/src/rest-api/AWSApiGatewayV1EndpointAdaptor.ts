import middy, { type MiddlewareObj } from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import set from 'lodash.set';
import { wrapError } from '../errors.ts';
import type { ConsoleLogger, Logger } from '../logger.ts';
import {
  type HermodServiceConstructor,
  HermodServiceDiscovery,
  type HermodServiceRecord,
} from '../services';
import type { Handler } from './Endpoint';
import type { EndpointSchemas, Method } from './types';

export class AWSApiGatewayV1EndpointAdaptor<
  S extends EndpointSchemas,
  Path extends string,
  TMethod extends Method,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> {
  constructor(
    private readonly endpoint: Handler<
      S,
      Path,
      TMethod,
      OutSchema,
      TServices,
      TLogger,
      TSession
    >,
  ) {}

  errors: MiddlewareObj<Event<TServices, TLogger>> = {
    onError: async (request) => {
      request.error = wrapError(request.error, 500, 'Internal Server Error');
    },
  };

  headers: MiddlewareObj<Event<TServices, TLogger>> = {
    before: async (request) => {
      const headers = Object.entries(request.event.headers || {});

      set(
        request.event,
        'req.headers',
        new Map(
          headers.map(([key, value]) => [key.toLowerCase(), value as string]),
        ),
      );
    },
  };
  session: MiddlewareObj<Event<TServices, TLogger, TSession>> = {
    before: async (request) => {
      request.event.session = await this.endpoint.getSession(
        request.event as any,
      );
    },
  };

  logger: MiddlewareObj<Event<TServices, TLogger>> = {
    before: async (request) => {
      request.event.logger = this.endpoint.logger.child({
        route: this.endpoint.route(),
        requestId: request.event.requestContext?.requestId,
        ip: request.event.requestContext?.http?.sourceIp,
        host: request.event.requestContext?.domainName,
        method: request.event.requestContext?.http?.method,
        path: request.event.requestContext?.http?.path,
      }) as TLogger;
    },
    after: async (request) => {},
  };

  services: MiddlewareObj<Event<TServices, TLogger>> = {
    before: async (request) => {
      const serviceDiscovery = HermodServiceDiscovery.getInstance();
      const services = await serviceDiscovery.register(this.endpoint.services);

      request.event.services = services;
    },
  };
  defaultBody: MiddlewareObj<Event<TServices, TLogger>> = {
    before: async (request) => {
      if (request.event.body === undefined) {
        request.event.body = '{}';
      }
    },
    after: async (request) => {},
  };
  parseData: MiddlewareObj<Event<TServices, TLogger>> = {
    before: async (request) => {
      const body = await this.endpoint.parseBody(request.event.body);
      const query = await this.endpoint.parseQuery(
        request.event.queryStringParameters || {},
      );
      const params = await this.endpoint.parseParams(
        request.event.pathParameters || {},
      );

      request.event.body = body;
      request.event.query = query;
      request.event.params = params;
    },
    after: async (request) => {
      const responseBody = request.response.body;
      const headers = (request.response.headers || {}) as Record<
        string,
        string
      >;
      if (responseBody) {
        request.response.headers = {
          ...headers,
          'Content-Type': 'application/json',
        };
      }
    },
  };

  authorize: MiddlewareObj<Event> = {
    before: async (request) => {
      const isAuthorized = await this.endpoint.authorize(request.event as any);

      if (!isAuthorized) {
        throw new Error('Unauthorized');
      }
    },
  };

  _handler = middy(async (event) => {
    const response = await this.endpoint.handler(event);

    const output = await this.endpoint.parseOutput(response);

    return {
      statusCode: this.endpoint.status,
      body: output ? JSON.stringify(output) : undefined,
    };
  })
    .use(this.errors)
    .use(this.headers)
    .use(this.logger)
    .use(this.services)
    .use(this.session)
    .use(httpHeaderNormalizer());

  get handler() {
    return ['GET', 'OPTIONS', 'DELETE'].includes(this.endpoint.method)
      ? this._handler.use(this.parseData).use(this.authorize)
      : this._handler
          .use(httpJsonBodyParser())
          .use(this.parseData)
          .use(this.authorize);
  }
}

type Event<
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> = APIGatewayProxyEventV2 & {
  body: any;
  query: any;
  params: any;
  services: HermodServiceRecord<TServices>;
  logger: TLogger;
  session: TSession;
  req: {
    headers: Map<string, string>;
  };
};
