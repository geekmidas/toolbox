import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Endpoint, EndpointSchemas } from '../constructs/Endpoint';
import type {
  HttpMethod,
  InferComposableStandardSchema,
} from '../constructs/types';
import type { ConsoleLogger, Logger } from '../logger';
import {
  type HermodServiceConstructor,
  HermodServiceDiscovery,
  type HermodServiceRecord,
} from '../services';

import type { EnvironmentParser } from '@geekmidas/envkit';
import middy, { type MiddlewareObj } from '@middy/core';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { wrapError } from '../errors';

export class AmazonApiGatewayV1Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> {
  constructor(
    private envParser: EnvironmentParser<{}>,
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

  private error(): Middleware<TInput, TServices, TLogger> {
    return {
      onError: (req) => {
        req.error = wrapError(req.error);
      },
    };
  }
  private logger(): Middleware<TInput, TServices, TLogger> {
    return {
      before: (req) => {
        req.event.logger = this.endpoint.logger.child({
          route: this.endpoint.route,
          host: req.event.headers?.host,
          method: this.endpoint.method,
          fn: {
            name: req.context.functionName,
            version: req.context.functionVersion,
          },
          req: {
            ip: req.event.requestContext?.identity?.sourceIp,
            userAgent: req.event.headers?.['user-agent'],
            path: req.event.path,
          },
        }) as TLogger;
      },
    };
  }
  private services(): Middleware<TInput, TServices, TLogger> {
    return {
      before: async (req) => {
        const logger = req.event.logger as TLogger;
        const serviceDiscovery = HermodServiceDiscovery.getInstance<
          HermodServiceRecord<TServices>,
          TLogger
        >(logger, this.envParser);

        req.event.services = await serviceDiscovery.register(
          this.endpoint.services,
        );
      },
    };
  }

  private session(): Middleware<TInput, TServices, TLogger> {
    return {
      before: async (req) => {
        const logger = req.event.logger as TLogger;
        const services = req.event.services as HermodServiceRecord<TServices>;
        req.event.session = await this.endpoint.getSession({
          logger,
          services,
          header: req.event.header,
        });
      },
    };
  }

  private async _handler(event: Event<TInput, TServices, TLogger>) {
    const input = {
      body: event.body,
      query: event.query,
      params: event.params,
    } as InferComposableStandardSchema<TInput>;

    const response = await this.endpoint.handler({
      header: event.header,
      logger: event.logger,
      services: event.services,
      session: {} as TSession,
      ...input,
    });

    const output = await this.endpoint.parseOutput(response);

    const body = output ? JSON.stringify(output) : undefined;

    return {
      statusCode: this.endpoint.status,
      body,
    };
  }

  get handler() {
    const handler = this._handler.bind(this);
    return middy(handler)
      .use(this.logger())
      .use(this.error())
      .use(this.services())
      .use(this.session()) as unknown as AmazonApiGatewayV1EndpointHandler;
  }
}

export type Event<
  TInput extends EndpointSchemas = {},
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> = {
  services: HermodServiceRecord<TServices>;
  logger: TLogger;
  header(string): string | undefined;
  session: TSession;
} & APIGatewayProxyEvent &
  InferComposableStandardSchema<TInput>;

type Middleware<
  TInput extends EndpointSchemas = {},
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
> = MiddlewareObj<Event<TInput, TServices, TLogger>>;

export type AmazonApiGatewayV1EndpointHandlerResponse = {
  statusCode: number;
  body: string;
};

export type AmazonApiGatewayV1EndpointHandler = (
  event: APIGatewayProxyEvent,
) => Promise<AmazonApiGatewayV1EndpointHandlerResponse>;
