import type {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayTokenAuthorizerEvent,
  Context as LambdaContext,
  Statement,
} from 'aws-lambda';

// Helper to access Resource property from Statement union type
type StatementWithResource = Statement & { Resource: string | string[] };

import * as jose from 'jose';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { OidcAuthorizer } from '../lambda/oidc';

// Mock discovery document
const mockDiscovery = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  userinfo_endpoint: 'https://auth.example.com/userinfo',
  jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
  scopes_supported: ['openid', 'profile', 'email'],
  response_types_supported: ['code', 'token'],
  claims_supported: ['sub', 'name', 'email'],
};

// Generate test keys and tokens - stored in object for mock access
const testKeys: {
  privateKey: jose.KeyLike | null;
  publicKey: jose.KeyLike | null;
} = {
  privateKey: null,
  publicKey: null,
};
let jwks: jose.JSONWebKeySet;

async function setupKeys() {
  const keyPair = await jose.generateKeyPair('RS256');
  testKeys.privateKey = keyPair.privateKey;
  testKeys.publicKey = keyPair.publicKey;
  const publicJwk = await jose.exportJWK(keyPair.publicKey);
  jwks = {
    keys: [{ ...publicJwk, kid: 'test-key-id', use: 'sig', alg: 'RS256' }],
  };
}

// Mock createRemoteJWKSet to return test keys directly.
// MSW intercepts jose's fetch in standalone scripts but fails in vitest for unknown reasons.
// TODO: Investigate vitest/MSW/jose interaction and remove this mock if possible.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof jose>();
  return {
    ...actual,
    createRemoteJWKSet: () => {
      return async (protectedHeader: jose.JWSHeaderParameters) => {
        if (protectedHeader.kid === 'test-key-id' && testKeys.publicKey) {
          return testKeys.publicKey;
        }
        throw new Error(`Unknown key ID: ${protectedHeader.kid}`);
      };
    },
  };
});

async function createTestToken(
  claims: Record<string, unknown> = {},
  options: { expiresIn?: string } = {},
) {
  if (!testKeys.privateKey) {
    throw new Error('Keys not initialized');
  }
  return await new jose.SignJWT({ sub: 'user-123', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
    .setIssuedAt()
    .setIssuer('https://auth.example.com')
    .setAudience('my-api')
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(testKeys.privateKey);
}

// MSW server setup
const server = setupServer(
  http.get('https://auth.example.com/.well-known/openid-configuration', () => {
    return HttpResponse.json(mockDiscovery);
  }),
  http.get('https://auth.example.com/.well-known/jwks.json', () => {
    return HttpResponse.json(jwks);
  }),
);

// Mock Lambda context
const mockContext: LambdaContext = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-authorizer',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
  memoryLimitInMB: '128',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/test',
  logStreamName: 'test-stream',
  getRemainingTimeInMillis: () => 5000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

describe('OidcAuthorizer', () => {
  beforeAll(async () => {
    await setupKeys();
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe('tokenHandler', () => {
    it('should allow valid token', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: `Bearer ${token}`,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });

    it('should deny invalid token', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: 'Bearer invalid-token',
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    });

    it('should handle token without Bearer prefix', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: token,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });

    it('should use wildcard resource by default', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: `Bearer ${token}`,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      const statement = result.policyDocument
        .Statement[0] as StatementWithResource;
      expect(statement.Resource).toBe(
        'arn:aws:execute-api:us-east-1:123456789:api-id/stage/*',
      );
    });

    it('should use exact resource when wildcardResource is false', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        wildcardResource: false,
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: `Bearer ${token}`,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      const statement = result.policyDocument
        .Statement[0] as StatementWithResource;
      expect(statement.Resource).toBe(
        'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      );
    });

    it('should use custom getPrincipalId', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        getPrincipalId: (claims) => `custom-${claims.sub}`,
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: `Bearer ${token}`,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('custom-user-123');
    });

    it('should include context from getContext', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        getContext: (claims) => ({
          userId: claims.sub!,
          role: 'admin',
        }),
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: `Bearer ${token}`,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      expect(result.context).toEqual({
        userId: 'user-123',
        role: 'admin',
      });
    });

    it('should deny when authorize callback returns false', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        authorize: () => false,
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: `Bearer ${token}`,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    });

    it('should allow when authorize callback returns true', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        authorize: (claims) => claims.sub === 'user-123',
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: `Bearer ${token}`,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });

    it('should support async authorize callback', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        authorize: async (claims) => {
          await Promise.resolve();
          return claims.sub === 'user-123';
        },
      });

      const token = await createTestToken();
      const event: APIGatewayTokenAuthorizerEvent = {
        type: 'TOKEN',
        authorizationToken: `Bearer ${token}`,
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
      };

      const handler = authorizer.tokenHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });
  });

  describe('requestHandler', () => {
    function createRequestEvent(
      headers: Record<string, string | undefined>,
    ): APIGatewayRequestAuthorizerEvent {
      return {
        type: 'REQUEST',
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
        headers,
        multiValueHeaders: null,
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '/resource',
        path: '/resource',
        httpMethod: 'GET',
      };
    }

    it('should allow valid token from authorization header', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const token = await createTestToken();
      const event = createRequestEvent({
        authorization: `Bearer ${token}`,
      });

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });

    it('should deny when no token is provided', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const event = createRequestEvent({});

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    });

    it('should extract token from cookie', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        extraction: {
          cookieName: 'auth_token',
        },
      });

      const token = await createTestToken();
      const event = createRequestEvent({
        cookie: `auth_token=${token}; other=value`,
      });

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });

    it('should handle case-insensitive header names', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const token = await createTestToken();
      const event = createRequestEvent({
        Authorization: `Bearer ${token}`,
      });

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });

    it('should extract token without prefix when configured', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        extraction: {
          headerName: 'x-auth-token',
          tokenPrefix: '',
        },
      });

      const token = await createTestToken();
      const event = createRequestEvent({
        'x-auth-token': token,
      });

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('user-123');
      expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });

    it('should deny invalid token', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const event = createRequestEvent({
        authorization: 'Bearer invalid-token',
      });

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    });

    it('should use wildcard resource by default', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const token = await createTestToken();
      const event = createRequestEvent({
        authorization: `Bearer ${token}`,
      });

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      const statement = result.policyDocument
        .Statement[0] as StatementWithResource;
      expect(statement.Resource).toBe(
        'arn:aws:execute-api:us-east-1:123456789:api-id/stage/*',
      );
    });

    it('should include context from getContext', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        getContext: (claims) => ({
          userId: claims.sub!,
        }),
      });

      const token = await createTestToken();
      const event = createRequestEvent({
        authorization: `Bearer ${token}`,
      });

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.context).toEqual({
        userId: 'user-123',
      });
    });

    it('should deny when authorize callback returns false', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
        authorize: () => false,
      });

      const token = await createTestToken();
      const event = createRequestEvent({
        authorization: `Bearer ${token}`,
      });

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    });

    it('should handle null headers gracefully', async () => {
      const authorizer = new OidcAuthorizer({
        config: {
          issuer: 'https://auth.example.com',
          audience: 'my-api',
        },
      });

      const event: APIGatewayRequestAuthorizerEvent = {
        type: 'REQUEST',
        methodArn:
          'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
        headers: null,
        multiValueHeaders: null,
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '/resource',
        path: '/resource',
        httpMethod: 'GET',
      };

      const handler = authorizer.requestHandler();
      const result = await handler(event, mockContext);

      expect(result.principalId).toBe('unauthorized');
      expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    });
  });
});
