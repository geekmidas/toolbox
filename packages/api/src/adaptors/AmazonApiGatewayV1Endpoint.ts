import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Endpoint, EndpointSchemas } from '../constructs/Endpoint';
import type { HttpMethod } from '../constructs/types';
import type { Logger } from '../logger';

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import type { EventPublisher } from '../constructs/events';
import type { Service } from '../services';
import {
  AmazonApiGatewayEndpoint,
  type AmazonApiGatewayV1EndpointHandler,
  type GetInputResponse,
  type LoggerContext,
} from './AmazonApiGatewayEndpoint';
import { parseQueryParams } from './utils/parseQueryParams';

export class AmazonApiGatewayV1Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
> extends AmazonApiGatewayEndpoint<
  AmazonApiGatewayV1EndpointHandler,
  APIGatewayProxyEvent,
  TRoute,
  TMethod,
  TInput,
  TOutSchema,
  TServices,
  TLogger,
  TSession,
  TEventPublisher
> {
  getInput(e: APIGatewayProxyEvent): GetInputResponse {
    // For arrays, AWS API Gateway V1 provides multiValueQueryStringParameters
    const multiValueParams = e.multiValueQueryStringParameters || {};
    const singleValueParams = e.queryStringParameters || {};

    // Merge single and multi-value parameters
    const mergedParams: Record<string, string | string[]> = {};

    // Add single value parameters
    for (const [key, value] of Object.entries(singleValueParams)) {
      if (value !== undefined) {
        mergedParams[key] = value;
      }
    }

    // Override with multi-value parameters where applicable
    for (const [key, values] of Object.entries(multiValueParams)) {
      if (values && values.length > 1) {
        mergedParams[key] = values;
      }
    }

    return {
      body: e.body ? JSON.parse(e.body) : undefined,
      query: parseQueryParams(mergedParams),
      params: e.pathParameters || {},
    };
  }
  getLoggerContext(
    data: APIGatewayProxyEvent,
    context: Context,
  ): LoggerContext {
    return {
      fn: {
        name: context.functionName,
        version: context.functionVersion,
      },
      req: {
        id: data.requestContext.requestId,
        awsRequestId: context.awsRequestId,
        ip: data.requestContext.identity.sourceIp,
        userAgent: data.requestContext.identity.userAgent || undefined,
        path: data.requestContext.path,
      },
    };
  }
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
      TEventPublisher
    >,
  ) {
    super(envParser, endpoint);
  }
}
