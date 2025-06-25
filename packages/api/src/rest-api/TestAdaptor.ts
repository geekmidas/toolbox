import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { HttpError } from '../errors';
import type { ConsoleLogger, Logger } from '../logger';
import type {
  HermodServiceConstructor,
  HermodServiceRecord,
} from '../services';
import { Handler } from './Endpoint';
import type { EndpointSchemas, InferStandardSchema, Method } from './types';

export interface TestRequest<
  S extends EndpointSchemas,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
> {
  headers?: Record<string, string>;
  body?: S['body'] extends StandardSchemaV1
    ? InferStandardSchema<S['body']>
    : any;
  query?: S['query'] extends StandardSchemaV1
    ? InferStandardSchema<S['query']>
    : any;
  params?: S['params'] extends StandardSchemaV1
    ? InferStandardSchema<S['params']>
    : any;
  services?: Partial<HermodServiceRecord<TServices>>;
  logger?: TLogger;
}

export type TestResponse<OutSchema extends StandardSchemaV1 | undefined> =
  | {
      statusCode: number;
      body?: OutSchema extends StandardSchemaV1
        ? InferStandardSchema<OutSchema>
        : any;
      headers?: Record<string, string>;
    }
  | HttpError;

export class TestAdaptor<
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

  async request(
    options: TestRequest<S, TServices, TLogger> = {},
  ): Promise<TestResponse<OutSchema>> {
    // Create default logger if not provided
    const logger = options.logger || this.endpoint.logger;

    // Create services object
    const services = this.createServices(options.services);

    // Parse and validate input data
    const body = await this.endpoint.parseBody(options.body);
    const query = await this.endpoint.parseQuery(options.query);
    const params = await this.endpoint.parseParams(options.params);

    // Create headers map
    const headersMap = Handler.normalizeHeaders(options.headers || {});

    // Get session
    const session = await this.endpoint.getSession({
      body,
      query,
      params,
      services,
      logger,
      req: { headers: headersMap },
      session: {} as TSession,
    } as any);

    // Create context
    const context = {
      body,
      query,
      params,
      services,
      logger,
      session,
      req: {
        headers: headersMap,
      },
    } as any;

    // Check authorization
    const isAuthorized = await this.endpoint.authorize(context);
    if (!isAuthorized) {
      throw new Error('Unauthorized');
    }

    try {
      // Execute handler
      const response = await this.endpoint.handler(context);

      // Parse and validate output
      const output = await this.endpoint.parseOutput(response);

      // Return response
      return {
        statusCode: this.endpoint.status,
        body: output as OutSchema extends StandardSchemaV1
          ? InferStandardSchema<OutSchema>
          : any,
      };
    } catch (error) {
      logger.error(error as Error);
      throw error;
    }
  }

  private createServices(
    partialServices?: Partial<HermodServiceRecord<TServices>>,
  ): HermodServiceRecord<TServices> {
    // Create a base services object with all required services
    const services = {} as HermodServiceRecord<TServices>;

    // Initialize each service from the endpoint's services array
    for (const ServiceConstructor of this.endpoint.services) {
      const serviceName = ServiceConstructor.serviceName;

      // Check if a partial service was provided
      if (partialServices && serviceName in partialServices) {
        services[serviceName] = partialServices[serviceName];
      } else {
        // Create a mock/default instance if not provided
        // You might want to customize this based on your service structure
        services[serviceName] = {} as any;
      }
    }

    return services;
  }

  // Helper method to test parsing separately
  async parseData(request: {
    body?: any;
    query?: any;
    params?: any;
  }): Promise<{
    body?: InferStandardSchema<S['body']>;
    query?: InferStandardSchema<S['query']>;
    params?: InferStandardSchema<S['params']>;
  }> {
    return {
      body: await this.endpoint.parseBody(request.body),
      query: await this.endpoint.parseQuery(request.query),
      params: await this.endpoint.parseParams(request.params),
    };
  }
}
