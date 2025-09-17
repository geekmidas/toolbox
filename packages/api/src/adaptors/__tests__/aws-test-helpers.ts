import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Context,
} from 'aws-lambda';
import { vi } from 'vitest';
import type { Logger } from '../../logger';

/**
 * Shared test utilities for AWS Lambda adapter testing
 */

/**
 * Creates a mock AWS Lambda Context for testing
 */
export function createMockContext(): Context {
  return {
    awsRequestId: 'test-request-id',
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn:
      'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '128',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2024/01/01/[$LATEST]abcdef123456',
    getRemainingTimeInMillis: () => 5000,
    done: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
  };
}

/**
 * Creates a mock AWS API Gateway V1 (REST API) event for testing
 */
export function createMockV1Event(
  overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'test-agent',
      host: 'test.example.com',
    },
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/test',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      path: '/test',
      stage: 'test',
      requestId: 'request-id',
      requestTimeEpoch: 1704067200000,
      resourceId: 'resource-id',
      resourcePath: '/test',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
        clientCert: null,
      },
    },
    resource: '/test',
    ...overrides,
  };
}

/**
 * Creates a mock AWS API Gateway V2 (HTTP API) event for testing
 */
export function createMockV2Event(
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /test',
    rawPath: '/test',
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'test-agent',
      host: 'test.example.com',
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'test.example.com',
      domainPrefix: 'api',
      requestId: 'request-id',
      routeKey: 'GET /test',
      stage: 'test',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
      http: {
        method: 'GET',
        path: '/test',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
      },
    },
    body: undefined,
    pathParameters: undefined,
    isBase64Encoded: false,
    stageVariables: undefined,
    queryStringParameters: undefined,
    cookies: undefined,
    ...overrides,
  };
}

/**
 * Creates a mock Logger for testing
 */
export function createMockLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

/**
 * Common test event types for AWS adapter testing
 */
export type TestEvent =
  | { type: 'user.created'; payload: { userId: string; email: string } }
  | { type: 'user.updated'; payload: { userId: string; changes: string[] } }
  | { type: 'notification.sent'; payload: { userId: string; type: string } };

/**
 * Mock service for testing
 */
export const TestService = {
  serviceName: 'TestService' as const,

  async register() {
    return this;
  },

  async cleanup() {},
};
