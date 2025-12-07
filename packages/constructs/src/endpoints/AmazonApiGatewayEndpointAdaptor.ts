import type { Logger } from '@geekmidas/logger';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { HttpMethod } from '../types';
import { Endpoint, type EndpointSchemas, ResponseBuilder } from './Endpoint';

import type { EnvironmentParser } from '@geekmidas/envkit';
import middy, { type MiddlewareObj } from '@middy/core';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Context,
} from 'aws-lambda';
import set from 'lodash.set';

import {
  UnauthorizedError,
  UnprocessableEntityError,
  wrapError,
} from '@geekmidas/errors';
import type { EventPublisher } from '@geekmidas/events';
import {
  type Service,
  ServiceDiscovery,
  type ServiceRecord,
} from '@geekmidas/services';

import type {
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/schema';
import { publishConstructEvents } from '../publisher';
import { processEndpointAudits } from './processAudits';

// Helper function to publish events

export abstract class AmazonApiGatewayEndpoint<
  THandler extends
    | AmazonApiGatewayV1EndpointHandler
    | AmazonApiGatewayV2EndpointHandler,
  TEvent extends HandlerEvent<THandler>,
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
  constructor(
    protected envParser: EnvironmentParser<{}>,
    protected readonly endpoint: Endpoint<
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
  ) {}

  private error(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      onError: (req) => {
        (req.event.logger || this.endpoint.logger).error(
          req.error || {},
          'Error processing request',
        );
        const wrappedError = wrapError(req.error);

        // Set the response with the proper status code from the HttpError
        req.response = {
          statusCode: wrappedError.statusCode,
          body: wrappedError.body,
        };
      },
    };
  }
  abstract getInput(e: TEvent): GetInputResponse;

  private input(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      before: async (req) => {
        try {
          const { body, query, params } = this.getInput(req.event);
          const headers = req.event.headers as Record<string, string>;
          const header = Endpoint.createHeaders(headers);
          const cookie = Endpoint.createCookies(headers.cookie);

          set(req.event, 'body', await this.endpoint.parseInput(body, 'body'));

          set(
            req.event,
            'query',
            await this.endpoint.parseInput(query, 'query'),
          );
          set(
            req.event,
            'params',
            await this.endpoint.parseInput(params, 'params'),
          );
          set(req.event, 'header', header);
          set(req.event, 'cookie', cookie);
        } catch (error) {
          // Convert validation errors to 422 Unprocessable Entity
          if (error && typeof error === 'object' && Array.isArray(error)) {
            throw new UnprocessableEntityError('Validation failed', error);
          }
          throw error;
        }
      },
    };
  }

  abstract getLoggerContext(data: TEvent, context: Context): LoggerContext;

  private logger(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      before: (req) => {
        req.event.logger = this.endpoint.logger.child({
          route: this.endpoint.route,
          host: req.event.headers?.host,
          method: this.endpoint.method,
          ...this.getLoggerContext(req.event, req.context),
        }) as TLogger;
      },
    };
  }
  private services(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      before: async (req) => {
        const logger = req.event.logger as TLogger;
        const serviceDiscovery = ServiceDiscovery.getInstance<
          ServiceRecord<TServices>,
          TLogger
        >(logger, this.envParser);

        const services = await serviceDiscovery.register(
          this.endpoint.services,
        );

        req.event.services = services;
      },
    };
  }

  private authorize(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      before: async (req) => {
        const logger = req.event.logger as TLogger;
        const services = req.event.services;
        const header = req.event.header;
        const cookie = req.event.cookie;
        const session = req.event.session as TSession;

        const isAuthorized = await this.endpoint.authorize({
          header,
          cookie,
          services,
          logger,
          session,
        });

        if (!isAuthorized) {
          logger.warn('Unauthorized access attempt');
          throw new UnauthorizedError(
            'Unauthorized access to the endpoint',
            'You do not have permission to access this resource.',
          );
        }
      },
    };
  }

  private session(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      before: async (req) => {
        const logger = req.event.logger as TLogger;
        const services = req.event.services;
        req.event.session = (await this.endpoint.getSession({
          logger,
          services,
          header: req.event.header,
          cookie: req.event.cookie,
        })) as TSession;
      },
    };
  }

  private events(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      after: async (req) => {
        const event = req.event;
        const response = (event as any)
          .__response as InferStandardSchema<TOutSchema>;
        const statusCode = req.response?.statusCode ?? this.endpoint.status;

        // Only publish events and process audits on successful responses (2xx status codes)
        if (Endpoint.isSuccessStatus(statusCode)) {
          const logger = event.logger as TLogger;
          const serviceDiscovery = ServiceDiscovery.getInstance<
            ServiceRecord<TServices>,
            TLogger
          >(logger, this.envParser);

          // Publish events
          await publishConstructEvents(
            this.endpoint,
            response,
            serviceDiscovery,
            logger,
          );

          // Process audits
          await processEndpointAudits(
            this.endpoint,
            response,
            serviceDiscovery,
            logger,
            {
              session: event.session,
              header: event.header,
              cookie: event.cookie,
              services: event.services as Record<string, unknown>,
            },
          );
        }
      },
    };
  }

  private async _handler(
    event: Event<TEvent, TInput, TServices, TLogger, TSession>,
  ) {
    const input = this.endpoint.refineInput(event);

    const responseBuilder = new ResponseBuilder();
    const response = await this.endpoint.handler(
      {
        header: event.header,
        cookie: event.cookie,
        logger: event.logger,
        services: event.services,
        session: event.session,
        ...input,
      },
      responseBuilder,
    );

    // Check if response has metadata
    let data = response;
    let metadata = responseBuilder.getMetadata();

    if (Endpoint.hasMetadata(response)) {
      data = response.data;
      metadata = response.metadata;
    }

    const output = this.endpoint.outputSchema
      ? await this.endpoint.parseOutput(data)
      : undefined;

    const body = output !== undefined ? JSON.stringify(output) : undefined;

    // Store response for middleware access
    (event as any).__response = output;

    // Build response with metadata
    const lambdaResponse: AmazonApiGatewayEndpointHandlerResponse = {
      statusCode: metadata.status ?? this.endpoint.status,
      body,
    };

    // Add custom headers
    if (metadata.headers && Object.keys(metadata.headers).length > 0) {
      lambdaResponse.headers = { ...metadata.headers };
    }

    // Format cookies as Set-Cookie headers
    if (metadata.cookies && metadata.cookies.size > 0) {
      const setCookieHeaders: string[] = [];
      for (const [name, { value, options }] of metadata.cookies) {
        setCookieHeaders.push(
          Endpoint.formatCookieHeader(name, value, options),
        );
      }

      if (setCookieHeaders.length > 0) {
        lambdaResponse.multiValueHeaders = {
          ...lambdaResponse.multiValueHeaders,
          'Set-Cookie': setCookieHeaders,
        };
      }
    }

    return lambdaResponse;
  }

  get handler() {
    const handler = this._handler.bind(this);
    return middy(handler)
      .use(this.logger())
      .use(this.error())
      .use(this.services())
      .use(this.input())
      .use(this.session())
      .use(this.authorize())
      .use(this.events()) as unknown as THandler;
  }
}

export type Event<
  TEvent extends APIGatewayProxyEvent | APIGatewayProxyEventV2,
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = {
  services: ServiceRecord<TServices>;
  logger: TLogger;
  header(key: string): string | undefined;
  cookie(name: string): string | undefined;
  session: TSession;
} & TEvent &
  InferComposableStandardSchema<TInput>;

type Middleware<
  TEvent extends APIGatewayProxyEvent | APIGatewayProxyEventV2,
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = MiddlewareObj<Event<TEvent, TInput, TServices, TLogger, TSession>>;

export type AmazonApiGatewayEndpointHandlerResponse = {
  statusCode: number;
  body: string | undefined;
  headers?: Record<string, string>;
  multiValueHeaders?: Record<string, string[]>;
};

export type LoggerContext = {
  fn: {
    name: string;
    version: string;
  };
  req: {
    id: string | undefined;
    awsRequestId: string;
    path: string;
    ip: string | undefined;
    userAgent: string | undefined;
  };
};

export type GetInputResponse = {
  body: any;
  query: any;
  params: any;
};

export type AmazonApiGatewayV1EndpointHandler = (
  event: APIGatewayProxyEvent,
  context: Context,
) => Promise<AmazonApiGatewayEndpointHandlerResponse>;

export type AmazonApiGatewayV2EndpointHandler = (
  event: APIGatewayProxyEventV2,
  context: Context,
) => Promise<AmazonApiGatewayEndpointHandlerResponse>;

export type HandlerEvent<T extends Function> = T extends (
  event: infer E,
  context: Context,
) => any
  ? E
  : never;
