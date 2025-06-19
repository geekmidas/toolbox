import middy, { type MiddlewareObj } from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Handler } from './Endpoint.ts';
import type { EndpointSchemas, Method } from './types.ts';

import { wrapError } from '../errors.ts';
import {
  type HermodServiceConstructor,
  HermodServiceDiscovery,
  type HermodServiceRecord,
} from '../services.ts';

export class AWSApiGatewayV1EndpointAdaptor<
  S extends EndpointSchemas,
  Path extends string,
  TMethod extends Method,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger = Console,
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

      request.event.headers = new Map(
        headers.map(([key, value]) => [key.toLowerCase(), value]),
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
      request.event.logger = this.endpoint.logger as TLogger;
      const { method, path, status } = this.endpoint;
      const { body, query, params } = request.event;
    },
    after: async (request) => {},
  };

  services: MiddlewareObj<Event<TServices, TLogger>> = {
    before: async (request) => {
      const serviceDiscovery = HermodServiceDiscovery.getInstance();
      request.event.services = await serviceDiscovery.register(
        this.endpoint.services,
      );
    },
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
      // You can add any post-processing logic here if needed
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

    return {
      statusCode: this.endpoint.status,
      body: response ? JSON.stringify(response) : undefined,
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
  TLogger = Console,
  TSession = unknown,
> = Omit<APIGatewayProxyEvent, 'headers'> & {
  body: any;
  query: any;
  params: any;
  services: HermodServiceRecord<TServices>;
  logger: TLogger;
  session: TSession;
  headers: Map<string, string>;
};
