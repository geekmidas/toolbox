import { EnvironmentParser } from '@geekmidas/envkit';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { e } from '../../constructs/EndpointFactory';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2Endpoint';

describe('AmazonApiGatewayV2Endpoint', () => {
  let envParser: EnvironmentParser<{}>;
  let mockContext: Context;

  beforeEach(() => {
    envParser = new EnvironmentParser({});
    mockContext = {
      functionName: 'test-function',
      functionVersion: '1',
      awsRequestId: 'test-request-id',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
      memoryLimitInMB: '128',
      logGroupName: '/aws/lambda/test',
      logStreamName: '2024/01/01/[$LATEST]test',
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    };
  });

  describe('getInput', () => {
    it('should parse request body, query, and params', () => {
      const endpoint = e.get('/test').handle(() => ({ success: true }));
      const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'GET /test',
        rawPath: '/test',
        rawQueryString: 'foo=bar&baz=qux',
        cookies: [],
        headers: {},
        queryStringParameters: { foo: 'bar', baz: 'qux' },
        pathParameters: { id: '123' },
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'api.example.com',
          domainPrefix: 'api',
          http: {
            method: 'GET',
            path: '/test',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test-agent',
          },
          requestId: 'request-id',
          routeKey: 'GET /test',
          stage: 'prod',
          time: '01/Jan/2024:00:00:00 +0000',
          timeEpoch: 1704067200000,
        },
        body: JSON.stringify({ name: 'test' }),
        isBase64Encoded: false,
      };

      const result = adapter.getInput(event);

      expect(result).toEqual({
        body: { name: 'test' },
        query: { foo: 'bar', baz: 'qux' },
        params: { id: '123' },
      });
    });

    it('should handle missing body, query, and params', () => {
      const endpoint = e.get('/test').handle(() => ({ success: true }));
      const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'GET /test',
        rawPath: '/test',
        rawQueryString: '',
        cookies: [],
        headers: {},
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'api.example.com',
          domainPrefix: 'api',
          http: {
            method: 'GET',
            path: '/test',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test-agent',
          },
          requestId: 'request-id',
          routeKey: 'GET /test',
          stage: 'prod',
          time: '01/Jan/2024:00:00:00 +0000',
          timeEpoch: 1704067200000,
        },
        isBase64Encoded: false,
      };

      const result = adapter.getInput(event);

      expect(result).toEqual({
        body: undefined,
        query: {},
        params: {},
      });
    });
  });

  describe('getLoggerContext', () => {
    it('should extract logger context from event and context', () => {
      const endpoint = e.get('/test').handle(() => ({ success: true }));
      const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'GET /test',
        rawPath: '/test',
        rawQueryString: '',
        cookies: [],
        headers: {},
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'api.example.com',
          domainPrefix: 'api',
          http: {
            method: 'GET',
            path: '/test/123',
            protocol: 'HTTP/1.1',
            sourceIp: '192.168.1.1',
            userAgent: 'Mozilla/5.0 Test',
          },
          requestId: 'event-request-id',
          routeKey: 'GET /test',
          stage: 'prod',
          time: '01/Jan/2024:00:00:00 +0000',
          timeEpoch: 1704067200000,
        },
        isBase64Encoded: false,
      };

      const result = adapter.getLoggerContext(event, mockContext);

      expect(result).toEqual({
        fn: {
          name: 'test-function',
          version: '1',
        },
        req: {
          id: 'event-request-id',
          awsRequestId: 'test-request-id',
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0 Test',
          path: '/test/123',
        },
      });
    });

    it('should handle missing user agent', () => {
      const endpoint = e.get('/test').handle(() => ({ success: true }));
      const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'GET /test',
        rawPath: '/test',
        rawQueryString: '',
        cookies: [],
        headers: {},
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'api.example.com',
          domainPrefix: 'api',
          http: {
            method: 'GET',
            path: '/test',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: '',
          },
          requestId: 'request-id',
          routeKey: 'GET /test',
          stage: 'prod',
          time: '01/Jan/2024:00:00:00 +0000',
          timeEpoch: 1704067200000,
        },
        isBase64Encoded: false,
      };

      const result = adapter.getLoggerContext(event, mockContext);

      expect(result.req.userAgent).toBeUndefined();
    });
  });

  describe('integration', () => {
    it('should handle endpoint with body schema validation', async () => {
      const endpoint = e
        .post('/users')
        .body(z.object({ name: z.string(), age: z.number() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .handle(async ({ body }) => ({
          id: '123',
          name: body.name,
        }));

      const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'POST /users',
        rawPath: '/users',
        rawQueryString: '',
        cookies: [],
        headers: { 'content-type': 'application/json' },
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'api.example.com',
          domainPrefix: 'api',
          http: {
            method: 'POST',
            path: '/users',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test',
          },
          requestId: 'request-id',
          routeKey: 'POST /users',
          stage: 'prod',
          time: '01/Jan/2024:00:00:00 +0000',
          timeEpoch: 1704067200000,
        },
        body: JSON.stringify({ name: 'John', age: 30 }),
        isBase64Encoded: false,
      };
      // @ts-ignore
      const response = await adapter.handler(event, mockContext);

      expect(response).toEqual({
        statusCode: 200,
        body: JSON.stringify({ id: '123', name: 'John' }),
      });
    });

    it('should handle endpoint with query and params', async () => {
      const endpoint = e
        .get('/users/:id')
        .params(z.object({ id: z.string() }))
        .query(z.object({ include: z.string().optional() }))
        .output(z.object({ id: z.string(), include: z.string().optional() }))
        .handle(async ({ params, query }) => ({
          id: params.id,
          include: query.include,
        }));

      const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'GET /users/{id}',
        rawPath: '/users/123',
        rawQueryString: 'include=profile',
        cookies: [],
        headers: {},
        queryStringParameters: { include: 'profile' },
        pathParameters: { id: '123' },
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'api.example.com',
          domainPrefix: 'api',
          http: {
            method: 'GET',
            path: '/users/123',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test',
          },
          requestId: 'request-id',
          routeKey: 'GET /users/{id}',
          stage: 'prod',
          time: '01/Jan/2024:00:00:00 +0000',
          timeEpoch: 1704067200000,
        },
        isBase64Encoded: false,
      };
      // @ts-ignore
      const response = await adapter.handler(event, mockContext);

      expect(response).toEqual({
        statusCode: 200,
        body: JSON.stringify({ id: '123', include: 'profile' }),
      });
    });
  });
});
