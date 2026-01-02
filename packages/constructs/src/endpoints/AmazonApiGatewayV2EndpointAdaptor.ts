import type { Logger } from '@geekmidas/logger';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { HttpMethod } from '../types';
import type { Endpoint, EndpointSchemas } from './Endpoint';

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher } from '@geekmidas/events';
import type { Service } from '@geekmidas/services';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import {
  AmazonApiGatewayEndpoint,
  type AmazonApiGatewayV2EndpointHandler,
  type GetInputResponse,
  type LoggerContext,
} from './AmazonApiGatewayEndpointAdaptor';
import { parseQueryParams } from './parseQueryParams';

export class AmazonApiGatewayV2Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
> extends AmazonApiGatewayEndpoint<
  AmazonApiGatewayV2EndpointHandler,
  APIGatewayProxyEventV2,
  TRoute,
  TMethod,
  TInput,
  TOutSchema,
  TServices,
  TLogger,
  TSession,
  TEventPublisher
> {
  override getInput(e: APIGatewayProxyEventV2): GetInputResponse {
    // API Gateway V2 handles arrays as comma-separated values
    const queryParams = e.queryStringParameters || {};
    const processedParams: Record<string, string | string[]> = {};

    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        // Check if value contains comma and could be an array
        // Be careful not to split values that legitimately contain commas
        if (value.includes(',') && !value.includes('"')) {
          processedParams[key] = value.split(',').map((v) => v.trim());
        } else {
          processedParams[key] = value;
        }
      }
    }

    return {
      body: e.body ? JSON.parse(e.body) : undefined,
      query: parseQueryParams(processedParams),
      params: e.pathParameters || {},
    };
  }
  override getLoggerContext(
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
    protected override envParser: EnvironmentParser<{}>,
    protected override readonly endpoint: Endpoint<
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
