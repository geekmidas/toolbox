import { EnvironmentParser } from '@geekmidas/envkit';
import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { e } from '../../constructs/EndpointFactory';
import type { EventPublisher, PublishableMessage } from '../../constructs/events';
import type { Logger } from '../../logger';
import { AmazonApiGatewayV1Endpoint } from '../AmazonApiGatewayV1Endpoint';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2Endpoint';

type TestEvent = PublishableMessage<'test.created' | 'test.updated', { id: string; name: string }>;

describe('AmazonApiGateway - Event Publishing', () => {
  const mockLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mockLogger),
  };

  const mockPublisher: EventPublisher<TestEvent> = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  const envParser = new EnvironmentParser({});

  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: 'test-log-group',
    logStreamName: 'test-log-stream',
    getRemainingTimeInMillis: () => 30000,
    done: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('API Gateway V1', () => {
    it('should publish events after successful endpoint execution', async () => {
      const endpoint = e
        .publisher(mockPublisher)
        .post('/test')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .event({
          type: 'test.created',
          payload: (ctx) => ({ id: ctx.response.id, name: ctx.response.name }),
        })
        .handle(async ({ body }) => ({
          id: '123',
          name: body.name,
        }));

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/test',
        body: JSON.stringify({ name: 'Test Item' }),
        headers: { 'Content-Type': 'application/json' },
        multiValueHeaders: {},
        isBase64Encoded: false,
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
      };

      const result = await handler(event, mockContext, vi.fn());

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body || '')).toEqual({ id: '123', name: 'Test Item' });

      // Verify event was published
      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
      expect(mockPublisher.publish).toHaveBeenCalledWith([
        {
          type: 'test.created',
          payload: { id: '123', name: 'Test Item' },
        },
      ]);
    });

    it('should respect event conditions', async () => {
      const endpoint = e
        .publisher(mockPublisher)
        .post('/test')
        .body(z.object({ name: z.string(), publish: z.boolean() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .event({
          type: 'test.created',
          payload: (ctx) => ({ id: ctx.response.id, name: ctx.response.name }),
          when: (ctx) => ctx.body.publish === true,
        })
        .handle(async ({ body }) => ({
          id: '123',
          name: body.name,
        }));

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/test',
        body: JSON.stringify({ name: 'Test Item', publish: false }),
        headers: { 'Content-Type': 'application/json' },
        multiValueHeaders: {},
        isBase64Encoded: false,
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
      };

      await handler(event, mockContext, vi.fn());
      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });

    it('should not publish events on error', async () => {
      const endpoint = e
        .publisher(mockPublisher)
        .post('/test')
        .body(z.object({ name: z.string() }))
        .event({
          type: 'test.created',
          payload: (ctx) => ({ id: '123', name: ctx.body.name }),
        })
        .handle(async () => {
          throw new Error('Test error');
        });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/test',
        body: JSON.stringify({ name: 'Test Item' }),
        headers: { 'Content-Type': 'application/json' },
        multiValueHeaders: {},
        isBase64Encoded: false,
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
      };

      const result = await handler(event, mockContext, vi.fn());
      expect(result.statusCode).toBe(500);
      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('API Gateway V2', () => {
    it('should publish events after successful endpoint execution', async () => {
      const endpoint = e
        .publisher(mockPublisher)
        .post('/test')
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .event({
          type: 'test.created',
          payload: (ctx) => ({ id: ctx.response.id, name: ctx.response.name }),
        })
        .handle(async ({ body }) => ({
          id: '123',
          name: body.name,
        }));

      const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'POST /test',
        rawPath: '/test',
        rawQueryString: '',
        headers: { 'content-type': 'application/json' },
        requestContext: {
          accountId: '123456789',
          apiId: 'test-api',
          domainName: 'test.execute-api.us-east-1.amazonaws.com',
          domainPrefix: 'test',
          http: {
            method: 'POST',
            path: '/test',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test',
          },
          requestId: 'test-request',
          routeKey: 'POST /test',
          stage: 'test',
          time: '01/Jan/2023:00:00:00 +0000',
          timeEpoch: 1672531200000,
        },
        body: JSON.stringify({ name: 'Test Item' }),
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext, vi.fn());

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body || '')).toEqual({ id: '123', name: 'Test Item' });

      // Verify event was published
      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
      expect(mockPublisher.publish).toHaveBeenCalledWith([
        {
          type: 'test.created',
          payload: { id: '123', name: 'Test Item' },
        },
      ]);
    });

    it('should have access to all context in event payload', async () => {
      const endpoint = e
        .publisher(mockPublisher)
        .post('/users/:userId')
        .params(z.object({ userId: z.string() }))
        .query(z.object({ include: z.string().optional() }))
        .body(z.object({ name: z.string() }))
        .output(z.object({ id: z.string(), name: z.string() }))
        .event({
          type: 'test.created',
          payload: (ctx) => ({
            id: ctx.response.id,
            name: ctx.body.name,
            userId: ctx.params.userId,
            include: ctx.query.include,
          }),
        })
        .handle(async ({ body, params }) => ({
          id: params.userId,
          name: body.name,
        }));

      const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'POST /users/{userId}',
        rawPath: '/users/user-123',
        rawQueryString: 'include=profile',
        pathParameters: { userId: 'user-123' },
        queryStringParameters: { include: 'profile' },
        headers: { 'content-type': 'application/json' },
        requestContext: {
          accountId: '123456789',
          apiId: 'test-api',
          domainName: 'test.execute-api.us-east-1.amazonaws.com',
          domainPrefix: 'test',
          http: {
            method: 'POST',
            path: '/users/user-123',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test',
          },
          requestId: 'test-request',
          routeKey: 'POST /users/{userId}',
          stage: 'test',
          time: '01/Jan/2023:00:00:00 +0000',
          timeEpoch: 1672531200000,
        },
        body: JSON.stringify({ name: 'Test User' }),
        isBase64Encoded: false,
      };

      await handler(event, mockContext, vi.fn());

      expect(mockPublisher.publish).toHaveBeenCalledWith([
        {
          type: 'test.created',
          payload: {
            id: 'user-123',
            name: 'Test User',
            userId: 'user-123',
            include: 'profile',
          },
        },
      ]);
    });
  });
});