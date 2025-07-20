import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Endpoint, EndpointSchemas } from '../constructs/Endpoint';
import type { HttpMethod } from '../constructs/types';
import type { Logger } from '../logger';

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import type { Service } from '../service-discovery';
import {
  AmazonApiGatewayEndpoint,
  type GetInputResponse,
  type LoggerContext,
} from './AmazonApiGatewayEndpoint';

export class AmazonApiGatewayV1Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> extends AmazonApiGatewayEndpoint<
  APIGatewayProxyEvent,
  TRoute,
  TMethod,
  TInput,
  TOutSchema,
  TServices,
  TLogger,
  TSession
> {
  getInput(e: APIGatewayProxyEvent): GetInputResponse {
    return {
      body: e.body ? JSON.parse(e.body) : undefined,
      query: e.queryStringParameters || {},
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
      TSession
    >,
  ) {
    super(envParser, endpoint);
  }
}
