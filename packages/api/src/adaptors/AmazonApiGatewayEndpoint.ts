import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Endpoint, type EndpointSchemas } from '../constructs/Endpoint';
import type { EventContext } from '../constructs/events';
import type {
  HttpMethod,
  InferComposableStandardSchema,
} from '../constructs/types';
import type { Logger } from '../logger';

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
} from '../errors';
import {
  type Service,
  ServiceDiscovery,
  type ServiceRecord,
} from '../services';

// Helper function to publish events
async function publishEndpointEvents<
  TInput extends EndpointSchemas,
  TServices extends Service[],
  TLogger extends Logger,
  TSession,
>(
  endpoint: Endpoint<any, any, TInput, any, TServices, TLogger, TSession, any>,
  context: {
    body: any;
    query: any;
    params: any;
    services: ServiceRecord<TServices>;
    logger: TLogger;
    session: TSession;
    response: any;
    header: (key: string) => string | undefined;
  },
): Promise<void> {
  if (!endpoint.publisher || !endpoint.events || endpoint.events.length === 0) {
    return;
  }

  const eventContext: EventContext<TInput, TServices, TLogger, TSession, any> = {
    body: context.body,
    query: context.query,
    params: context.params,
    services: context.services,
    logger: context.logger,
    session: context.session,
    response: context.response,
    header: context.header,
  };

  const eventsToPublish: any[] = [];
  for (const event of endpoint.events) {
    // Check if event should be published
    if (!event.when || (await event.when(eventContext))) {
      eventsToPublish.push({
        type: event.type,
        payload: await event.payload(eventContext),
      });
    }
  }

  if (eventsToPublish.length > 0) {
    await endpoint.publisher.publish(eventsToPublish);
  }
}

export abstract class AmazonApiGatewayEndpoint<
  TEvent extends APIGatewayProxyEvent | APIGatewayProxyEventV2,
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
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
      TSession
    >,
  ) {}

  private error(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      onError: (req) => {
        (req.event.logger || this.endpoint.logger).error(req.error || {}, 'Error processing request');
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
        const session = req.event.session as TSession;

        const isAuthorized = await this.endpoint.authorize({
          header,
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
        })) as TSession;
      },
    };
  }

  private events(): Middleware<TEvent, TInput, TServices, TLogger> {
    return {
      after: async (req) => {
        const event = req.event;
        const response = (event as any).__response;
        const input = (event as any).__input;

        if (!response || !input) {
          return;
        }

        await publishEndpointEvents(this.endpoint, {
          body: input.body,
          query: input.query,
          params: input.params,
          services: event.services,
          logger: event.logger,
          session: event.session,
          response,
          header: event.header,
        });
      },
    };
  }

  private async _handler(
    event: Event<TEvent, TInput, TServices, TLogger, TSession>,
  ) {
    const input = this.endpoint.refineInput(event);

    const response = await this.endpoint.handler({
      header: event.header,
      logger: event.logger,
      services: event.services,
      session: event.session,
      ...input,
    });

    const output = await this.endpoint.parseOutput(response);

    const body = output ? JSON.stringify(output) : undefined;

    // Store response for middleware access
    (event as any).__response = output || response;
    (event as any).__input = input;

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
      .use(this.input())
      .use(this.session())
      .use(this.authorize())
      .use(this.events()) as unknown as AmazonApiGatewayV1EndpointHandler;
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

export type AmazonApiGatewayV1EndpointHandlerResponse = {
  statusCode: number;
  body: string | undefined;
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
) => Promise<AmazonApiGatewayV1EndpointHandlerResponse>;
