import type {
	APIGatewayRequestAuthorizerEvent,
	APIGatewayTokenAuthorizerEvent,
	Context as LambdaContext,
} from 'aws-lambda';
import * as jose from 'jose';
import { describe, expect, it } from 'vitest';
import { JwtAuthorizer } from '../lambda/jwt';

const TEST_SECRET = 'super-secret-key-for-testing-only-32chars';
const TEST_METHOD_ARN =
	'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource';

async function createTestToken(
	claims: Record<string, unknown> = {},
	secret = TEST_SECRET,
) {
	const secretKey = new TextEncoder().encode(secret);
	return await new jose.SignJWT({ sub: 'user-123', ...claims })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(secretKey);
}

function createTokenEvent(
	token: string,
	methodArn = TEST_METHOD_ARN,
): APIGatewayTokenAuthorizerEvent {
	return {
		type: 'TOKEN',
		authorizationToken: `Bearer ${token}`,
		methodArn,
	};
}

function createRequestEvent(
	headers: Record<string, string> = {},
	methodArn = TEST_METHOD_ARN,
): APIGatewayRequestAuthorizerEvent {
	return {
		type: 'REQUEST',
		methodArn,
		headers,
		multiValueHeaders: {},
		pathParameters: null,
		queryStringParameters: null,
		multiValueQueryStringParameters: null,
		stageVariables: null,
		requestContext: {} as any,
		resource: '',
		path: '',
		httpMethod: 'GET',
	};
}

const mockLambdaContext = {} as LambdaContext;

describe('JwtAuthorizer', () => {
	describe('tokenHandler()', () => {
		it('should allow valid token', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
			});
			const handler = authorizer.tokenHandler();

			const token = await createTestToken();
			const event = createTokenEvent(token);

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
			expect(result.principalId).toBe('user-123');
		});

		it('should deny invalid token', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
			});
			const handler = authorizer.tokenHandler();

			const event = createTokenEvent('invalid-token');

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
			expect(result.principalId).toBe('unauthorized');
		});

		it('should use wildcard resource by default', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
			});
			const handler = authorizer.tokenHandler();

			const token = await createTestToken();
			const event = createTokenEvent(token);

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Resource).toBe(
				'arn:aws:execute-api:us-east-1:123456789:api-id/stage/*',
			);
		});

		it('should use exact resource when wildcardResource is false', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
				wildcardResource: false,
			});
			const handler = authorizer.tokenHandler();

			const token = await createTestToken();
			const event = createTokenEvent(token);

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Resource).toBe(TEST_METHOD_ARN);
		});

		it('should use custom getPrincipalId', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
				getPrincipalId: (claims) => `custom-${claims.sub}`,
			});
			const handler = authorizer.tokenHandler();

			const token = await createTestToken();
			const event = createTokenEvent(token);

			const result = await handler(event, mockLambdaContext);

			expect(result.principalId).toBe('custom-user-123');
		});

		it('should include context from getContext', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
				getContext: (claims) => ({
					userId: claims.sub!,
					role: 'admin',
				}),
			});
			const handler = authorizer.tokenHandler();

			const token = await createTestToken();
			const event = createTokenEvent(token);

			const result = await handler(event, mockLambdaContext);

			expect(result.context).toEqual({
				userId: 'user-123',
				role: 'admin',
			});
		});

		it('should deny when custom authorize returns false', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
				authorize: (claims) => claims.sub === 'admin',
			});
			const handler = authorizer.tokenHandler();

			const token = await createTestToken();
			const event = createTokenEvent(token);

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
		});

		it('should allow when custom authorize returns true', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
				authorize: (claims) => claims.sub === 'user-123',
			});
			const handler = authorizer.tokenHandler();

			const token = await createTestToken();
			const event = createTokenEvent(token);

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
		});

		it('should handle token without Bearer prefix', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
			});
			const handler = authorizer.tokenHandler();

			const token = await createTestToken();
			const event: APIGatewayTokenAuthorizerEvent = {
				type: 'TOKEN',
				authorizationToken: token, // No Bearer prefix
				methodArn: TEST_METHOD_ARN,
			};

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
		});
	});

	describe('requestHandler()', () => {
		it('should allow valid token from Authorization header', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
			});
			const handler = authorizer.requestHandler();

			const token = await createTestToken();
			const event = createRequestEvent({ Authorization: `Bearer ${token}` });

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
		});

		it('should deny when no token provided', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
			});
			const handler = authorizer.requestHandler();

			const event = createRequestEvent({});

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
		});

		it('should extract token from custom header', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
				extraction: { headerName: 'x-api-token', tokenPrefix: '' },
			});
			const handler = authorizer.requestHandler();

			const token = await createTestToken();
			const event = createRequestEvent({ 'x-api-token': token });

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
		});

		it('should extract token from cookie', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
				extraction: { cookieName: 'session' },
			});
			const handler = authorizer.requestHandler();

			const token = await createTestToken();
			const event = createRequestEvent({ cookie: `session=${token}` });

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
		});

		it('should handle case-insensitive headers', async () => {
			const authorizer = new JwtAuthorizer({
				config: { secret: TEST_SECRET },
			});
			const handler = authorizer.requestHandler();

			const token = await createTestToken();
			const event = createRequestEvent({ authorization: `Bearer ${token}` });

			const result = await handler(event, mockLambdaContext);

			expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
		});
	});
});
