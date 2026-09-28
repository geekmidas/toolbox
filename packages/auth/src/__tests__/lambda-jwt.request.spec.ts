import type {
	APIGatewayRequestAuthorizerEvent,
	Context as LambdaContext,
} from 'aws-lambda';
import * as jose from 'jose';
import { describe, expect, it } from 'vitest';
import { JwtAuthorizer } from '../lambda/jwt';

const SECRET = 'super-secret-key-for-testing-only-32chars';
const ARN = 'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource';
const context = {} as LambdaContext;

async function token(claims: Record<string, unknown> = { sub: 'user-1' }) {
	return new jose.SignJWT(claims)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(new TextEncoder().encode(SECRET));
}

function event(
	headers: Record<string, string> | null,
): APIGatewayRequestAuthorizerEvent {
	return {
		type: 'REQUEST',
		methodArn: ARN,
		headers,
		multiValueHeaders: {},
		pathParameters: null,
		queryStringParameters: null,
		multiValueQueryStringParameters: null,
		stageVariables: null,
		requestContext: {} as never,
		resource: '',
		path: '',
		httpMethod: 'GET',
	} as APIGatewayRequestAuthorizerEvent;
}

const effect = (
	result: Awaited<ReturnType<ReturnType<JwtAuthorizer['requestHandler']>>>,
) => result.policyDocument.Statement[0]?.Effect;

describe('JwtAuthorizer.requestHandler', () => {
	it('denies when the event carries no headers at all', async () => {
		const handler = new JwtAuthorizer({
			config: { secret: SECRET },
		}).requestHandler();

		expect(effect(await handler(event(null), context))).toBe('Deny');
	});

	it('denies a token that does not verify', async () => {
		const handler = new JwtAuthorizer({
			config: { secret: SECRET },
		}).requestHandler();

		const result = await handler(
			event({ Authorization: 'Bearer not-a-jwt' }),
			context,
		);

		expect(effect(result)).toBe('Deny');
		expect(result.principalId).toBe('unauthorized');
	});

	it('takes a header value as the token when it carries no prefix', async () => {
		const handler = new JwtAuthorizer({
			config: { secret: SECRET },
		}).requestHandler();

		const result = await handler(
			event({ Authorization: await token() }),
			context,
		);

		expect(effect(result)).toBe('Allow');
	});

	it('strips a custom prefix', async () => {
		const handler = new JwtAuthorizer({
			config: { secret: SECRET },
			extraction: { headerName: 'X-Token', tokenPrefix: 'Token ' },
		}).requestHandler();

		const result = await handler(
			event({ 'x-token': `Token ${await token()}` }),
			context,
		);

		expect(effect(result)).toBe('Allow');
	});

	it('falls back to the cookie when the header is empty', async () => {
		const handler = new JwtAuthorizer({
			config: { secret: SECRET },
			extraction: { cookieName: 'session' },
		}).requestHandler();

		const result = await handler(
			event({ Authorization: '', Cookie: `other=1; session=${await token()}` }),
			context,
		);

		expect(effect(result)).toBe('Allow');
	});

	it('denies when the named cookie is not there', async () => {
		const handler = new JwtAuthorizer({
			config: { secret: SECRET },
			extraction: { cookieName: 'session' },
		}).requestHandler();

		expect(effect(await handler(event({ cookie: 'other=1' }), context))).toBe(
			'Deny',
		);
	});

	it('applies the authorize hook, allowing and denying', async () => {
		const handler = new JwtAuthorizer({
			config: { secret: SECRET },
			authorize: (claims) => (claims as { role?: string }).role === 'admin',
		}).requestHandler();

		const admin = await handler(
			event({
				Authorization: `Bearer ${await token({ sub: 'a', role: 'admin' })}`,
			}),
			context,
		);
		const guest = await handler(
			event({
				Authorization: `Bearer ${await token({ sub: 'g', role: 'guest' })}`,
			}),
			context,
		);

		expect(effect(admin)).toBe('Allow');
		expect(admin.principalId).toBe('a');
		expect(effect(guest)).toBe('Deny');
	});

	it("names the principal 'unknown' when the token has no subject", async () => {
		const handler = new JwtAuthorizer({
			config: { secret: SECRET },
		}).requestHandler();

		const result = await handler(
			event({ Authorization: `Bearer ${await token({ scope: 'x' })}` }),
			context,
		);

		expect(effect(result)).toBe('Allow');
		expect(result.principalId).toBe('unknown');
	});
});
