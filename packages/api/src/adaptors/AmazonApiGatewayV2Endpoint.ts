import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Endpoint, EndpointSchemas } from '../constructs/Endpoint';
import type { HttpMethod } from '../constructs/types';
import type { Logger } from '../logger';

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import type { Service } from '../services';
import {
  AmazonApiGatewayEndpoint,
  type GetInputResponse,
  type LoggerContext,
} from './AmazonApiGatewayEndpoint';

export class AmazonApiGatewayV2Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> extends AmazonApiGatewayEndpoint<
  APIGatewayProxyEventV2,
  TRoute,
  TMethod,
  TInput,
  TOutSchema,
  TServices,
  TLogger,
  TSession
> {
  getInput(e: APIGatewayProxyEventV2): GetInputResponse {
    return {
      body: e.body ? JSON.parse(e.body) : undefined,
      query: e.queryStringParameters || {},
      params: e.pathParameters || {},
    };
  }
  getLoggerContext(
    event: APIGatewayProxyEventV2,
    context: Context,
  ): LoggerContext {
    return {
      fn: {
        name: context.functionName,
        version: context.functionVersion,
      },
      req: {
        id: event.requestContext.requestId,
        awsRequestId: context.awsRequestId,
        ip: event.requestContext.http.sourceIp,
        userAgent: event.requestContext.http.userAgent || undefined,
        path: event.requestContext.http.path,
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
      TSession
    >,
  ) {
    super(envParser, endpoint);
  }
}
